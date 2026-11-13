//go:build windows

// Installeur de Player X (ou de Player X V3 Test, selon payload/info.json) : une fenêtre sans cadre dessinée comme l'appli (WebView2, déjà présent sous Windows 10
// et 11), qui installe l'installeur signé habituel en silencieux. Sans WebView2, l'installeur classique s'ouvre.
//
//	Player-X-Installer.exe                    installation normale
//	Player-X-Installer.exe --selftest [image.png]   ouvre la fenêtre, attend la page, vérifie qu'elle est vraiment dessinée
//	                                                (capture enregistrée dans image.png), puis se ferme (code 0 si tout va bien)
//	Player-X-Installer.exe --selftest-install <dossier>   installe sans fenêtre dans <dossier> (vérification en CI)
package main

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"playerx-installer/internal/webview2"
)

//go:embed ui/page.html
var page string

//go:embed payload/setup.exe
var setupExe []byte

//go:embed payload/info.json
var infoJSON []byte

//go:embed payload/icon.png
var iconPNG []byte

// trace : journal de démarrage dans %TEMP%\\<Slug>-Installer.log (PlayerXInstaller.log pour Player X),
// pour comprendre un affichage raté sur un PC.
func trace(format string, a ...any) {
	f, err := os.OpenFile(filepath.Join(os.TempDir(), tempName()+".log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s  %s\n", time.Now().Format("15:04:05.000"), fmt.Sprintf(format, a...))
}

// tempName : nom du journal et du dossier de WebView2. Celui de Player X ne change pas ; une autre appli a le sien,
// pour que deux installeurs ouverts en même temps ne se gênent pas.
func tempName() string {
	if app.Slug == "Player-X" {
		return "PlayerXInstaller"
	}
	return app.Slug + "-Installer"
}

// logoRect : la place du logo dans la page (pixels CSS), envoyée par pxReady pour la vérification --selftest.
type logoRect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

func init() {
	// WebView2 et les boîtes de dialogue veulent le fil principal, initialisé en STA.
	runtime.LockOSThread()
}

func main() {
	var info payloadInfo
	if err := json.Unmarshal(infoJSON, &info); err != nil || len(setupExe) < 1024 {
		messageBox(0, app.Name, "Cet installeur est incomplet. Télécharge-le à nouveau.", false)
		os.Exit(1)
	}
	info = info.withDefaults()
	app = info
	cleanupSetups()
	args := os.Args[1:]
	if len(args) == 2 && args[0] == "--selftest-install" {
		os.Exit(selftestInstall(info, args[1]))
	}
	selftest := len(args) >= 1 && args[0] == "--selftest"
	shot := ""
	if selftest && len(args) == 2 {
		shot = args[1]
	}

	data := filepath.Join(os.TempDir(), tempName())
	defer os.RemoveAll(data)
	scale := dpiScale()
	trace("démarrage %s, échelle %.2f, fenêtre %dx%d", info.Version, scale, uint(880*scale), uint(690*scale))
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  data,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:     "Installation de " + app.Name,
			Width:     uint(880 * scale),
			Height:    uint(690 * scale),
			IconId:    1,
			Center:    true,
			Frameless: true,
			// Diagnostic (essai automatique) : PXI_EARLY=1 affiche la fenêtre avant la page.
			Hidden: os.Getenv("PXI_EARLY") != "1",
			// Fond de l'appli (#0c0a11, en 0x00BBGGRR) : la fenêtre n'est jamais transparente, même avant la page.
			Background: 0x00110A0C,
		},
	})
	if w == nil {
		trace("WebView2 indisponible : installeur classique")
		// Pas de WebView2 : l'installeur classique, avec ses fenêtres Windows.
		if selftest {
			os.Exit(2)
		}
		if err := classic(info.Version); err != nil {
			messageBox(0, app.Name, "L'installation n'a pas pu démarrer. Télécharge l'installeur à nouveau, puis réessaie. ("+err.Error()+")", false)
			os.Exit(1)
		}
		return
	}
	defer w.Destroy()
	hwnd := uintptr(w.Window())
	if os.Getenv("PXI_NOROUND") != "1" {
		roundWindow(hwnd)
	}
	if os.Getenv("PXI_NOBG") != "1" {
		w.SetBackground(0x0c, 0x0a, 0x11)
	}

	var (
		mu      sync.Mutex
		busy    bool
		dir     = defaultDir()
		shown   bool
		ready   bool // la page a appelé pxReady : elle s'est vraiment chargée
		code    = 0
		logo    = logoRect{X: 440 - 64, Y: 122, W: 128, H: 128} // ancienne page, si elle n'envoie rien
		showNow = func() {
			if !shown {
				shown = true
				trace("affichage de la fenêtre")
				w.Show()
				foreground(hwnd)
			}
		}
	)

	_ = w.Bind("pxReady", func(r ...logoRect) {
		trace("page prête")
		ready = true
		if len(r) == 1 && r[0].W > 0 && r[0].H > 0 {
			logo = r[0]
		}
		showNow()
		if selftest {
			go func() {
				time.Sleep(2500 * time.Millisecond)
				w.Dispatch(func() {
					if !drawn(hwnd, shot, scale, logo) {
						code = 4
					}
					closeWindow(hwnd)
				})
			}()
		}
	})
	_ = w.Bind("pxInfo", func() map[string]any {
		mu.Lock()
		d := dir
		mu.Unlock()
		free, _ := freeBytes(existingParent(d))
		return map[string]any{
			"version": info.Version, "dir": d, "need": info.Size, "free": free, "update": existingDir() != "",
			"name": app.Name, "fixed": app.FixedDir, "updates": !app.NoUpdates, "boot": !app.NoBoot,
		}
	})
	_ = w.Bind("pxFree", func(d string) uint64 {
		free, _ := freeBytes(existingParent(d))
		return free
	})
	_ = w.Bind("pxPick", func(current string) (string, error) {
		if app.FixedDir {
			return "", fmt.Errorf("%s s'installe toujours dans son propre dossier.", app.Name)
		}
		p, err := pickFolder(hwnd, existingParent(current), "Où installer "+app.Name+" ?")
		if err != nil || p == "" {
			return "", err
		}
		n, err := normalizeDir(p)
		if err != nil {
			return "", err
		}
		mu.Lock()
		dir = n
		mu.Unlock()
		return n, nil
	})
	_ = w.Bind("pxInstall", func(o Options) error {
		mu.Lock()
		defer mu.Unlock()
		if busy {
			return fmt.Errorf("L'installation est déjà en cours.")
		}
		busy = true
		dir = o.Dir
		go install(info, o, func(p Progress) {
			if p.Error != "" || p.Step == 3 {
				mu.Lock()
				busy = false
				mu.Unlock()
			}
			b, _ := json.Marshal(p)
			w.Dispatch(func() { w.Eval("window.pxProgress && window.pxProgress(" + string(b) + ")") })
		})
		return nil
	})
	_ = w.Bind("pxLaunch", func(d string) error {
		if err := launch(d); err != nil {
			return err
		}
		w.Dispatch(func() { closeWindow(hwnd) })
		return nil
	})
	_ = w.Bind("pxClassic", func() error {
		if err := classic(info.Version); err != nil {
			return err
		}
		w.Dispatch(func() { closeWindow(hwnd) })
		return nil
	})
	_ = w.Bind("pxDrag", func() { dragWindow(hwnd) })
	_ = w.Bind("pxMinimize", func() { minimizeWindow(hwnd) })
	_ = w.Bind("pxClose", func() {
		mu.Lock()
		b := busy
		mu.Unlock()
		if !b {
			closeWindow(hwnd)
		}
	})

	html := strings.Replace(page, "__PX_ICON__", "data:image/png;base64,"+base64.StdEncoding.EncodeToString(iconPNG), -1)
	w.SetHtml(html)
	// Filet de sécurité : la fenêtre s'affiche même si la page tarde à le demander.
	go func() {
		time.Sleep(3 * time.Second)
		w.Dispatch(showNow)
		if selftest {
			time.Sleep(10 * time.Second)
			w.Dispatch(func() {
				// Le filet de sécurité affiche la fenêtre de toute façon : c'est pxReady qui prouve que la page a chargé.
				if !ready {
					code = 3
				}
				closeWindow(hwnd)
			})
		}
	}()
	w.Run()
	if selftest && code != 0 {
		os.Exit(code)
	}
}

// selftestInstall : installation sans fenêtre, pour la vérification automatique (GitHub Actions).
func selftestInstall(info payloadInfo, dir string) int {
	// Le dossier demandé est respecté, même pour une version au dossier fixe : l'essai ne touche jamais à la vraie installation.
	selftestDir = dir
	ok := true
	install(info, Options{Dir: dir, Desktop: false, Boot: false}, func(p Progress) {
		fmt.Printf("étape %d · %d %%", p.Step, p.Percent)
		if p.Note != "" {
			fmt.Printf(" · %s", p.Note)
		}
		if p.Error != "" {
			fmt.Printf(" · ERREUR : %s", p.Error)
			ok = false
		}
		fmt.Println()
	})
	if !ok {
		return 1
	}
	return 0
}

// drawn : la page est-elle vraiment à l'écran ? Le logo (rose) doit apparaître là où la page dit l'avoir placé.
// Les captures sont enregistrées dans shot (et shot-ecran.png) quand un chemin est donné.
func drawn(hwnd uintptr, shot string, scale float64, logo logoRect) bool {
	ok := false
	for i, fromScreen := range []bool{false, true} {
		img, err := captureWindow(hwnd, fromScreen)
		if err != nil {
			fmt.Println("capture :", err)
			continue
		}
		if shot != "" {
			name := shot
			if i == 1 {
				name = strings.TrimSuffix(shot, ".png") + "-ecran.png"
			}
			if f, err := os.Create(name); err == nil {
				_ = png.Encode(f, img)
				f.Close()
			}
		}
		b := img.Bounds()
		// Le blason : contour et chevrons roses sur un écu sombre (environ 20 % de pixels roses dans son rectangle).
		left, top := int(logo.X*scale), int(logo.Y*scale)
		right, bottom := left+int(logo.W*scale), top+int(logo.H*scale)
		pink, all := 0, 0
		for y := top; y < bottom && y < b.Dy(); y += 4 {
			for x := left; x < right && x < b.Dx(); x += 4 {
				c := img.RGBAAt(x, y)
				all++
				if c.R > 190 && c.G < 150 {
					pink++
				}
			}
		}
		share := 0
		if all > 0 {
			share = pink * 100 / all
		}
		bg := img.RGBAAt(int(20*scale), b.Dy()-int(40*scale))
		fmt.Printf("capture %d (%s) : %dx%d, logo rose à %d %%, fond %d,%d,%d\n", i, map[bool]string{false: "PrintWindow", true: "écran"}[fromScreen], b.Dx(), b.Dy(), share, bg.R, bg.G, bg.B)
		if share >= 12 {
			ok = true
		}
	}
	return ok
}
