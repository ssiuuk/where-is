package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

const phoneUpload = `{
  "places": [
    {"id":"phoneshelf00001","name":"Top shelf","parent":"phonecupbd00001","label_at":"2026-11-10 10:00:00.000Z"},
    {"id":"phonecupbd00001","name":"Cupboard","parent":""},
    {"id":"phonelost000001","name":"Lost box","parent":"phonegone000001"}
  ],
  "items": [
    {"id":"phonetorch00001","name":"Torch","tags":["Tools","tools"," "],"aliases":["flashlight"],"place":"phoneshelf00001","moved_at":"2026-11-12 09:30:00.000Z"},
    {"id":"phonetape000001","name":"Tape","place":"phonegone000001"}
  ],
  "moves": [
    {"id":"phonemove000001","item":"phonetorch00001","from_place":"","to_place":"phonecupbd00001","to_name":"Cupboard","created":"2026-11-11 08:00:00.000Z"},
    {"id":"phonemove000002","item":"phonetorch00001","from_place":"phonecupbd00001","to_place":"phoneshelf00001","from_name":"Cupboard","to_name":"Cupboard › Top shelf","created":"2026-11-12 09:30:00.000Z"},
    {"id":"phonemove000003","item":"someoneelses001","to_place":"phonecupbd00001","created":"2026-11-12 09:30:00.000Z"}
  ]
}`

func TestImportPhone(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "needs a household", Method: http.MethodPost,
		URL:            "/api/whereis/import-phone",
		Headers:        map[string]string{"Authorization": token(t, f.dan)},
		Body:           strings.NewReader(phoneUpload),
		ExpectedStatus: 400,
	})
	run(t, f, tests.ApiScenario{
		Name: "uploads with the phone's ids", Method: http.MethodPost,
		URL:             "/api/whereis/import-phone",
		Headers:         map[string]string{"Authorization": token(t, f.ann)},
		Body:            strings.NewReader(phoneUpload),
		ExpectedStatus:  200,
		ExpectedContent: []string{`"places":3`, `"items":2`, `"moves":2`, `"skipped":0`},
	})

	shelf, err := f.app.FindRecordById("places", "phoneshelf00001")
	if err != nil || shelf.GetString("household") != f.h1.Id || shelf.GetString("parent") != "phonecupbd00001" {
		t.Fatalf("shelf not uploaded under the cupboard: %v", err)
	}
	if shelf.GetDateTime("label_at").IsZero() {
		t.Fatal("label_at lost")
	}
	if lost, _ := f.app.FindRecordById("places", "phonelost000001"); lost == nil || lost.GetString("parent") != "" {
		t.Fatal("a place with a missing parent should go to the top level")
	}
	torch, _ := f.app.FindRecordById("items", "phonetorch00001")
	if torch.GetString("place") != "phoneshelf00001" || torch.GetString("moved_by") != f.ann.Id {
		t.Fatalf("torch place/moved_by = %q/%q", torch.GetString("place"), torch.GetString("moved_by"))
	}
	if tags := torch.GetStringSlice("tags"); len(tags) != 1 || tags[0] != "tools" {
		t.Fatalf("tags not tidied: %v", tags)
	}
	if tape, _ := f.app.FindRecordById("items", "phonetape000001"); tape.GetString("place") != "" {
		t.Fatal("an unknown place should be dropped")
	}
	m, _ := f.app.FindRecordById("moves", "phonemove000001")
	if m == nil || m.GetString("by") != f.ann.Id || !strings.HasPrefix(m.GetDateTime("created").String(), "2026-11-11 08:00:00") {
		t.Fatalf("history not kept as it happened: %v", m)
	}
	if countMoves(t, f, "phonetorch00001") != 2 {
		t.Fatal("expected the torch's two moves")
	}

	run(t, f, tests.ApiScenario{
		Name: "repeating an upload changes nothing", Method: http.MethodPost,
		URL:             "/api/whereis/import-phone",
		Headers:         map[string]string{"Authorization": token(t, f.ben)},
		Body:            strings.NewReader(phoneUpload),
		ExpectedStatus:  200,
		ExpectedContent: []string{`"places":0`, `"items":0`, `"moves":0`, `"skipped":7`},
	})
	run(t, f, tests.ApiScenario{
		Name: "another household can't take the same ids", Method: http.MethodPost,
		URL:             "/api/whereis/import-phone",
		Headers:         map[string]string{"Authorization": token(t, f.cat)},
		Body:            strings.NewReader(phoneUpload),
		ExpectedStatus:  400,
		ExpectedContent: []string{"different household"},
	})
	if n, _ := f.app.CountRecords("items", nil); n == 0 {
		t.Fatal("items vanished")
	}
	run(t, f, tests.ApiScenario{
		Name: "a bad record fails the whole upload", Method: http.MethodPost,
		URL:     "/api/whereis/import-phone",
		Headers: map[string]string{"Authorization": token(t, f.cat)},
		Body: strings.NewReader(`{"places":[{"id":"catplace0000001","name":"Hall"}],
			"items":[{"id":"catitem00000001","name":""}]}`),
		ExpectedStatus:  400,
		ExpectedContent: []string{"Nothing was changed"},
	})
	if p, _ := f.app.FindRecordById("places", "catplace0000001"); p != nil {
		t.Fatal("a failed upload left a place behind")
	}
}
