//go:build windows

package main

// Installation proprement dite : l'installeur signé habituel de l'appli (NSIS, le même que pour les mises à jour)
// est lancé en silencieux dans le dossier choisi. La progression suit la taille réellement copiée ; chaque étape
// n'est cochée qu'après vérification sur le disque.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// payloadInfo : décrit l'installeur embarqué et l'appli qu'il installe (écrit à la construction,
// scripts/build-installer.mjs pour Player X, scripts/build-installer-v3test.mjs pour Player X V3 Test).
// Un champ absent garde la valeur du vrai Player X (withDefaults) : un ancien info.json se comporte comme avant.
type payloadInfo struct {
	Version string `json:"version"`
	Size    int64  `json:"size"` // octets une fois installé (dossier win-unpacked)

	Name     string `json:"name"`     // nom affiché (productName) : « Player X », « Player X V3 Test »
	Exe      string `json:"exe"`      // exécutable installé : « Player X.exe »
	DirName  string `json:"dirName"`  // dossier sous %LOCALAPPDATA%\Programs (le « name » de package.json pour NSIS)
	DataDir  string `json:"dataDir"`  // dossier des données sous %APPDATA% (userData d'Electron = productName)
	Shortcut string `json:"shortcut"` // nom des raccourcis .lnk (shortcutName de NSIS)
	Display  string `json:"display"`  // DisplayName de la clé de désinstallation (début du nom)
	Slug     string `json:"slug"`     // fichiers temporaires et journal : « Player-X »

	// FixedDir : le dossier ne se choisit pas (version d'essai installée à part : jamais dans celui d'une autre).
	FixedDir bool `json:"fixedDir"`
	// NoUpdates : l'appli n'a pas de mises à jour automatiques (pas d'app-update.yml à vérifier).
	NoUpdates bool `json:"noUpdates"`
	// NoBoot : pas d'option « Démarrer avec Windows » dans la fenêtre.
	NoBoot bool `json:"noBoot"`
}

// withDefaults complète les champs absents avec ceux du vrai Player X.
func (i payloadInfo) withDefaults() payloadInfo {
	def := func(v *string, d string) {
		if strings.TrimSpace(*v) == "" {
			*v = d
		}
	}
	def(&i.Name, "Player X")
	def(&i.Exe, i.Name+".exe")
	def(&i.DirName, i.Name)
	def(&i.DataDir, i.Name)
	def(&i.Shortcut, i.Name)
	def(&i.Display, i.Name)
	def(&i.Slug, strings.ReplaceAll(i.Name, " ", "-"))
	return i
}

// app : l'appli que cet installeur installe (lue dans payload/info.json au démarrage).
var app = payloadInfo{}.withDefaults()

// Options choisies dans la fenêtre.
type Options struct {
	Dir     string `json:"dir"`
	Desktop bool   `json:"desktop"`
	Boot    bool   `json:"boot"`
}

// Progress : envoyé à la page à chaque changement. Step : 0 copie, 1 raccourcis, 2 mises à jour (ou vérification), 3 fini.
// Error est la phrase pour l'utilisateur (ce qui s'est passé et quoi faire) ; Detail, le message technique, copié à part.
type Progress struct {
	Percent int    `json:"percent"`
	Step    int    `json:"step"`
	Error   string `json:"error,omitempty"`
	Detail  string `json:"detail,omitempty"`
	Code    string `json:"code,omitempty"` // "space" (place), "busy" (appli ouverte), "files", "check"
	Note    string `json:"note,omitempty"`
}

// stepError : une erreur avec sa phrase pour l'utilisateur et son détail technique.
type stepError struct{ msg, detail string }

func (e *stepError) Error() string { return e.msg }

// standardDir : le dossier d'installation habituel (par utilisateur), %LOCALAPPDATA%\Programs\<DirName>.
func standardDir() string {
	return filepath.Join(knownDir("LOCALAPPDATA", windows.FOLDERID_LocalAppData, "Local"), "Programs", app.DirName)
}

// knownDir : un dossier de l'utilisateur (%LOCALAPPDATA%, %APPDATA%). Variable vide ou relative (session étrange) :
// on demande à Windows le vrai dossier, au lieu d'installer dans un chemin relatif au dossier courant.
func knownDir(env string, id *windows.KNOWNFOLDERID, under string) string {
	if d := os.Getenv(env); d != "" && filepath.IsAbs(d) {
		return d
	}
	if d, err := windows.KnownFolderPath(id, 0); err == nil && d != "" {
		return d
	}
	return filepath.Join(os.Getenv("USERPROFILE"), "AppData", under)
}

// defaultDir : l'installation existante si l'appli est déjà là, sinon le dossier habituel.
func defaultDir() string {
	if d := existingDir(); d != "" {
		return d
	}
	return standardDir()
}

// existingDir lit le dossier d'une installation précédente (clé de désinstallation écrite par NSIS).
func existingDir() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Uninstall`, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return ""
	}
	defer k.Close()
	names, _ := k.ReadSubKeyNames(-1)
	for _, n := range names {
		sk, err := registry.OpenKey(k, n, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		name, _, _ := sk.GetStringValue("DisplayName")
		loc, _, _ := sk.GetStringValue("InstallLocation")
		sk.Close()
		// Même nom, ou même nom suivi de la version (« Player X 0.9.7 »). L'exécutable doit aussi être le bon :
		// « Player X V3 Test » commence par « Player X », mais son dossier n'a pas de « Player X.exe ».
		if strings.EqualFold(name, app.Display) || strings.HasPrefix(name, app.Display+" ") {
			if loc != "" && exists(filepath.Join(loc, app.Exe)) {
				return loc
			}
		}
	}
	// La clé ne donne pas toujours le dossier : l'emplacement habituel suffit s'il contient l'appli.
	if d := standardDir(); exists(filepath.Join(d, app.Exe)) {
		return d
	}
	return ""
}

// normalizeDir : un dossier choisi qui ne s'appelle pas <DirName> en reçoit un sous-dossier, comme les autres installeurs.
// Dossier fixe (FixedDir) : toujours le dossier habituel, quoi que la page envoie.
// selftestDir : dossier de l'essai automatique (--selftest-install), prioritaire sur le dossier fixe.
var selftestDir string

func normalizeDir(dir string) (string, error) {
	if app.FixedDir && selftestDir == "" {
		return defaultDir(), nil
	}
	dir = strings.TrimSpace(dir)
	if dir == "" || !filepath.IsAbs(dir) {
		return "", errors.New("Choisis un dossier sur un disque de ce PC.")
	}
	dir = filepath.Clean(dir)
	if strings.ContainsAny(dir, `"<>|?*`) {
		return "", errors.New("Ce nom de dossier contient un caractère que Windows refuse. Choisis-en un autre.")
	}
	if !strings.EqualFold(filepath.Base(dir), app.DirName) {
		dir = filepath.Join(dir, app.DirName)
	}
	return dir, nil
}

// existingParent : le dossier lui-même ou son premier parent qui existe (pour mesurer la place libre).
func existingParent(dir string) string {
	for d := dir; ; d = filepath.Dir(d) {
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			return d
		}
		if filepath.Dir(d) == d {
			return d
		}
	}
}

func dirSize(dir string) int64 {
	var n int64
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if fi, err := d.Info(); err == nil {
				n += fi.Size()
			}
		}
		return nil
	})
	return n
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func copyFile(from, to string) bool {
	if from == "" {
		return false
	}
	b, err := os.ReadFile(from)
	return err == nil && os.WriteFile(to, b, 0o644) == nil
}

// fileLocked : le fichier existe mais Windows refuse de l'ouvrir en écriture (programme en cours d'exécution).
func fileLocked(p string) bool {
	f, err := os.OpenFile(p, os.O_WRONLY, 0)
	if err != nil {
		return exists(p)
	}
	_ = f.Close()
	return false
}

// cleanupSetups efface les installeurs déposés dans le dossier temporaire par un lancement précédent (le repli
// classique ne peut pas effacer le sien : l'installeur Go est déjà fermé quand il finit). Un fichier encore ouvert reste.
func cleanupSetups() {
	old, _ := filepath.Glob(filepath.Join(os.TempDir(), app.Slug+"-Setup-*.exe"))
	for _, p := range old {
		_ = os.Remove(p)
	}
}

// writeSetup dépose l'installeur embarqué dans le dossier temporaire.
func writeSetup(version string) (string, error) {
	p := filepath.Join(os.TempDir(), fmt.Sprintf("%s-Setup-%s.exe", app.Slug, version))
	if err := os.WriteFile(p, setupExe, 0o755); err != nil {
		return "", &stepError{"Windows n'a pas laissé préparer les fichiers d'installation. Redémarre ton PC, puis réessaie.", err.Error()}
	}
	return p, nil
}

// runSilent lance l'installeur NSIS sans fenêtre. /D doit être le dernier argument, sans guillemets (règle NSIS).
func runSilent(setup, dir string) *exec.Cmd {
	cmd := exec.Command(setup)
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: fmt.Sprintf(`"%s" /S /D=%s`, setup, dir)}
	return cmd
}

// install déroule l'installation et rend compte par report (appelé hors du fil de la fenêtre).
func install(info payloadInfo, o Options, report func(Progress)) {
	fail := func(step int, code, msg, detail string) {
		report(Progress{Step: step, Code: code, Error: msg, Detail: detail})
	}
	dir, err := normalizeDir(o.Dir)
	if err != nil {
		fail(0, "files", err.Error(), "")
		return
	}
	if free, err := freeBytes(existingParent(dir)); err == nil && info.Size > 0 && free < uint64(info.Size) {
		fail(0, "space", fmt.Sprintf("Il faut %d Mo de libre sur ce disque. Libère de la place, puis réessaie.", (info.Size+1048575)/1048576),
			fmt.Sprintf("libre %d octets, besoin %d octets, %s", free, info.Size, dir))
		return
	}
	// Mise à jour d'une installation existante : ses réglages (démarrage avec Windows, raccourci du Bureau) sont gardés.
	update := existingDir() != ""
	report(Progress{Percent: 1, Step: 0})
	setup, err := writeSetup(info.Version)
	if err != nil {
		se, _ := err.(*stepError)
		if se == nil {
			se = &stepError{err.Error(), ""}
		}
		fail(0, "files", se.msg, se.detail)
		return
	}
	defer os.Remove(setup)

	// 1. Copie des fichiers : la progression suit la taille du dossier, jusqu'à la fin de l'installeur.
	cmd := runSilent(setup, dir)
	if err := cmd.Start(); err != nil {
		fail(0, "files", "Windows a bloqué l'installation. Réessaie, ou ouvre l'installeur classique.", err.Error())
		return
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	last := 1
	// La barre ne reste jamais figée : en plus de la taille copiée (qui ne dit rien pendant une mise à jour, le dossier
	// ayant déjà sa taille), elle avance avec le temps, vers la durée de la dernière installation sur ce PC.
	t0 := time.Now()
	tau := expectedSeconds() / 3
wait:
	for {
		select {
		case err := <-done:
			if err != nil {
				code := -1
				var ee *exec.ExitError
				if errors.As(err, &ee) {
					code = ee.ExitCode()
				}
				detail := fmt.Sprintf("code de sortie de l'installeur %d (%v), dossier %s", code, err, dir)
				// Appli encore ouverte : son exe est verrouillé. Sinon (antivirus, disque, droits) : un autre message.
				if fileLocked(filepath.Join(dir, app.Exe)) {
					fail(0, "busy", "La copie des fichiers n'a pas abouti. Ferme "+app.Name+" (aussi près de l'horloge), puis réessaie.", detail)
				} else {
					fail(0, "files", "La copie des fichiers n'a pas abouti. Vérifie la place libre et ton antivirus, puis réessaie, ou ouvre l'installeur classique.", detail)
				}
				return
			}
			break wait
		case <-tick.C:
			// Avec le temps : 68 × (1 − e^(−t/τ)), qui ralentit sans jamais s'arrêter.
			p := int(67 * (1 - math.Exp(-time.Since(t0).Seconds()/tau)))
			// Nouvelle installation : la taille copiée, si elle est plus avancée. Une réinstallation retire d'abord
			// l'ancienne version : la barre ne recule jamais.
			if !update && info.Size > 0 {
				if q := int(float64(dirSize(dir)) / float64(info.Size) * 67); q > p {
					p = q
				}
			}
			if p > 67 {
				p = 67
			}
			if p > last {
				last = p
				report(Progress{Percent: p, Step: 0})
			}
		}
	}
	rememberSeconds(time.Since(t0).Seconds())
	report(Progress{Percent: 68, Step: 0})
	exe := filepath.Join(dir, app.Exe)
	if !exists(exe) {
		fail(0, "files", app.Name+" n'est pas dans son dossier après la copie. Réessaie, ou ouvre l'installeur classique.", "introuvable : "+exe)
		return
	}
	report(Progress{Percent: 70, Step: 1})

	// 2. Raccourcis : celui du menu Démarrer est créé par l'installeur ; celui du Bureau est retiré s'il n'est pas voulu.
	note := ""
	desk := filepath.Join(specialFolder(csidlDesktop), app.Shortcut+".lnk")
	startLnk := ""
	if start := specialFolder(csidlPrograms); start != "" {
		startLnk = filepath.Join(start, app.Shortcut+".lnk")
	}
	if startLnk == "" || !exists(startLnk) {
		note = "Le raccourci du menu Démarrer n'a pas été trouvé."
	}
	if !o.Desktop {
		// Nouvelle installation seulement : une mise à jour ne retire pas un raccourci que l'utilisateur a gardé.
		if !update {
			_ = os.Remove(desk)
		}
	} else if !exists(desk) {
		// L'installeur silencieux ne crée pas toujours celui du Bureau : copie de celui du menu Démarrer (même cible).
		if !copyFile(startLnk, desk) {
			note = strings.TrimSpace(note + " Le raccourci du Bureau n'a pas pu être créé.")
		}
	}
	time.Sleep(350 * time.Millisecond)
	report(Progress{Percent: 88, Step: 2, Note: note})

	// 3. Mises à jour signées : le fichier qui relie l'appli à ses mises à jour doit être en place.
	//    Sans mises à jour automatiques (version d'essai) : vérification du cœur de l'appli.
	if app.NoUpdates {
		if !exists(filepath.Join(dir, "resources", "app.asar")) {
			fail(2, "check", "Il manque un fichier de "+app.Name+". Réessaie, ou ouvre l'installeur classique.", "introuvable : "+filepath.Join(dir, "resources", "app.asar"))
			return
		}
	} else if !exists(filepath.Join(dir, "resources", "app-update.yml")) {
		fail(2, "check", "Le fichier des mises à jour automatiques manque. Ouvre l'installeur classique pour réparer.", "introuvable : resources\\app-update.yml")
		return
	}
	if !update && !app.NoBoot {
		writeFirstRun(o)
	}
	time.Sleep(350 * time.Millisecond)
	report(Progress{Percent: 100, Step: 3, Note: note})
}

// writeFirstRun : les choix que l'appli applique à son premier lancement (Démarrer avec Windows).
func writeFirstRun(o Options) {
	dir := filepath.Join(knownDir("APPDATA", windows.FOLDERID_RoamingAppData, "Roaming"), app.DataDir)
	_ = os.MkdirAll(dir, 0o755)
	b, _ := json.Marshal(map[string]any{"startWithWindows": o.Boot})
	_ = os.WriteFile(filepath.Join(dir, "install-options.json"), b, 0o644)
}

// launch démarre l'appli, détachée de l'installeur.
func launch(dir string) error {
	d, err := normalizeDir(dir)
	if err != nil {
		return err
	}
	cmd := exec.Command(filepath.Join(d, app.Exe))
	cmd.Dir = d
	return cmd.Start()
}

// classic lance l'installeur habituel, avec ses fenêtres (repli si WebView2 manque, ou après une erreur).
func classic(version string) error {
	setup, err := writeSetup(version)
	if err != nil {
		return err
	}
	return exec.Command(setup).Start()
}

// Durée de la copie la dernière fois (petit fichier dans %LOCALAPPDATA%), pour une barre qui avance à la bonne allure.
func durationFile() string {
	return filepath.Join(knownDir("LOCALAPPDATA", windows.FOLDERID_LocalAppData, "Local"), app.Slug+"-installation.txt")
}

func expectedSeconds() float64 {
	b, err := os.ReadFile(durationFile())
	if err == nil {
		if v, e := strconv.ParseFloat(strings.TrimSpace(string(b)), 64); e == nil && v >= 2 && v <= 300 {
			return v
		}
	}
	return 14
}

func rememberSeconds(v float64) {
	if v >= 2 && v <= 300 {
		_ = os.WriteFile(durationFile(), []byte(strconv.FormatFloat(v, 'f', 1, 64)), 0o644)
	}
}
