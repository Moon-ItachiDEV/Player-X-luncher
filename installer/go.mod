module playerx-installer

go 1.22

require (
	github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1
	golang.org/x/sys v0.30.0
)

// golang.org n'est pas joignable partout : même code, pris sur son miroir GitHub (dépendances livrées dans vendor/).
replace golang.org/x/sys => github.com/golang/sys v0.30.0
