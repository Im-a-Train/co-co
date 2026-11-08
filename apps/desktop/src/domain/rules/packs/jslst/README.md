# Rule pack `coco-js-lst` (co-co J+S Lagersport/Trekking 2026.2)

Format, schemas and how to add a rule: `docs/plans/rules-v2/infra-api.md`.

```
pack.yaml            # pack metadata + modules (js, lst, lst-lager, lst-trekking, lst-berg, lst-wasser, lst-winter, lst-ebb)
params.yaml          # versioned thresholds (rows by camp start date)
keywords/*.yaml      # keyword sets per module; keywords/docCheck.yaml = safety-concept document check
rules/<RULE-ID>.yaml # one file per rule (schema v2)
predicates/<module>.ts + predicates/index.ts
```

The old pack id `coco-basis` is accepted through `aliases` (also on `coco-pbs`).
