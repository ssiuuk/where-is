package main

import (
	"fmt"
	"strings"
	"unicode/utf8"

	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
)

// Limits for an item's tags and aliases.
const (
	maxTags     = 20
	maxTagLen   = 40
	maxAliases  = 20
	maxAliasLen = 120
)

// tidyItemNames cleans up an item's tags and aliases before every save,
// whether it comes from the app, the web app or the dashboard: extra spaces
// are removed, empty entries and repeats (ignoring case) are dropped, and
// tags are stored in lower case so "Tools" and "tools" group together.
func tidyItemNames(e *core.RecordEvent) error {
	errs := validation.Errors{}
	if err := tidyList(e.Record, "tags", maxTags, maxTagLen, true); err != nil {
		errs["tags"] = err
	}
	if err := tidyList(e.Record, "aliases", maxAliases, maxAliasLen, false); err != nil {
		errs["aliases"] = err
	}
	if len(errs) > 0 {
		return errs
	}
	return e.Next()
}

func tidyList(r *core.Record, field string, maxCount, maxLen int, lower bool) error {
	var raw []string
	if v := r.GetString(field); v != "" && v != "null" {
		if err := r.UnmarshalJSONField(field, &raw); err != nil {
			return validation.NewError("validation_invalid_list", "Must be a list of words.")
		}
	}
	list, err := tidyNames(raw, maxCount, maxLen, lower)
	if err != nil {
		return err
	}
	r.Set(field, list)
	return nil
}

// tidyNames is the list clean-up behind tidyItemNames.
func tidyNames(raw []string, maxCount, maxLen int, lower bool) ([]string, error) {
	list := []string{}
	seen := map[string]bool{}
	for _, s := range raw {
		s = strings.Join(strings.Fields(s), " ")
		if lower {
			s = strings.ToLower(s)
		}
		key := strings.ToLower(s)
		if s == "" || seen[key] {
			continue
		}
		if utf8.RuneCountInString(s) > maxLen {
			return nil, validation.NewError("validation_too_long", fmt.Sprintf("Keep each one to %d characters or fewer.", maxLen))
		}
		seen[key] = true
		list = append(list, s)
	}
	if len(list) > maxCount {
		return nil, validation.NewError("validation_too_many", fmt.Sprintf("Up to %d per item.", maxCount))
	}
	return list, nil
}
