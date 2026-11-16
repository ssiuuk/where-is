package main

import (
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestTidyNames(t *testing.T) {
	got, err := tidyNames([]string{"  Tools ", "tools", "", "Power   tools", "TOOLS"}, 20, 40, true)
	if err != nil || !reflect.DeepEqual(got, []string{"tools", "power tools"}) {
		t.Fatalf("tags: %v %v", got, err)
	}
	got, err = tidyNames([]string{"Hoover", " hoover", "Vacuum  cleaner"}, 20, 120, false)
	if err != nil || !reflect.DeepEqual(got, []string{"Hoover", "Vacuum cleaner"}) {
		t.Fatalf("aliases: %v %v", got, err)
	}
	if _, err := tidyNames([]string{strings.Repeat("a", 41)}, 20, 40, true); err == nil {
		t.Fatal("a 41 character tag was accepted")
	}
	if _, err := tidyNames([]string{"a", "b", "c"}, 2, 40, true); err == nil {
		t.Fatal("too many tags were accepted")
	}
	if got, _ := tidyNames(nil, 2, 40, true); got == nil || len(got) != 0 {
		t.Fatalf("no tags should be an empty list, got %#v", got)
	}
}

func TestItemTagsAndAliases(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()
	auth := map[string]string{"Authorization": token(t, f.ann)}

	run(t, f, tests.ApiScenario{
		Name: "create with tags and aliases", Method: http.MethodPost,
		URL:     "/api/collections/items/records",
		Headers: auth,
		Body: strings.NewReader(`{"household":"` + f.h1.Id + `","name":"Vacuum",` +
			`"tags":[" Cleaning","cleaning","Upstairs "],"aliases":["Hoover","  dyson "]}`),
		ExpectedStatus:  200,
		ExpectedContent: []string{`"tags":["cleaning","upstairs"]`, `"aliases":["Hoover","dyson"]`},
	})
	run(t, f, tests.ApiScenario{
		Name: "update tags", Method: http.MethodPatch,
		URL:             "/api/collections/items/records/" + f.drill.Id,
		Headers:         auth,
		Body:            strings.NewReader(`{"tags":["Tools","DIY"]}`),
		ExpectedStatus:  200,
		ExpectedContent: []string{`"tags":["tools","diy"]`, `"aliases":[]`},
	})
	run(t, f, tests.ApiScenario{
		Name: "tags must be a list of words", Method: http.MethodPatch,
		URL:             "/api/collections/items/records/" + f.drill.Id,
		Headers:         auth,
		Body:            strings.NewReader(`{"tags":{"a":1}}`),
		ExpectedStatus:  400,
		ExpectedContent: []string{`"tags"`},
	})
	run(t, f, tests.ApiScenario{
		Name: "too many aliases", Method: http.MethodPatch,
		URL:     "/api/collections/items/records/" + f.drill.Id,
		Headers: auth,
		Body: strings.NewReader(`{"aliases":["1","2","3","4","5","6","7","8","9","10","11",` +
			`"12","13","14","15","16","17","18","19","20","21"]}`),
		ExpectedStatus:  400,
		ExpectedContent: []string{`"aliases"`},
	})
	d, _ := f.app.FindRecordById("items", f.drill.Id)
	if got := d.GetString("tags"); got != `["tools","diy"]` {
		t.Fatalf("drill tags = %s", got)
	}
}
