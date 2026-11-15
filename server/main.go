// Command whereis runs the Where Is server: PocketBase with the household
// collections, invite codes, move history and tag landing pages.
package main

import (
	"log"
	"os"

	"github.com/pocketbase/pocketbase"

	_ "github.com/ssiuuk/where-is/server/migrations"
)

func main() {
	app := pocketbase.New()

	Register(app, ConfigFromEnv(os.Getenv))

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
