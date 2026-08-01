# Mockup navigation pedigree

This is the intended reachable graph for `?mockup=1`. Every screen has an explicit parent path and every primary action has a destination.

```text
HOME
├── Campaign
│   ├── Choose or edit deck ──> COLLECTION ── Save/close ──> CAMPAIGN
│   └── Start campaign battle ──> BATTLE (campaign mode)
├── Collection ──> COLLECTION ── Save/close ──> HOME
└── Compete
    ├── Choose deck ──> COLLECTION ── Save/close ──> COMPETE
    ├── Ready up / Unready ──> COMPETE
    ├── Start compete battle ──> BATTLE (compete mode)
    └── Leave lobby ──> HOME

BATTLE
├── Back to campaign/lobby ──> originating screen
├── Artifact “Main menu” ──> HOME
└── Battle result ──> RESULT
    ├── Play again ──> CAMPAIGN
    └── Return home ──> HOME
```

Data carried across transitions:

- Collection edits mutate the active deck and preserve the originating screen.
- Campaign and Compete pass the selected deck order and leader into the playable battle artifact.
- Battle mode controls the battle header and its contextual back destination.
- The artifact posts its result to the parent spine, which owns the Result screen transition.

Review checklist:

- No primary screen is only reachable through an unreachable action.
- No actionable control is a no-op.
- Every battle entry has a contextual back path and a home escape path.
- Every playable battle outcome has a result path and restart/home exits.
