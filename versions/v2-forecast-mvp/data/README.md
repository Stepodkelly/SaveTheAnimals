# V2 Data Filing

Large machine-generated data and human review files must remain separate.

## Principle

```text
Machine-generated data
+ human override files
= reviewed dataset
```

## Layout

```text
data/
├── aoi/
├── catalog/
├── events/
├── derived/
├── reviews/
└── models/
```

## Review Rule

Edit override files, not generated catalogues.
