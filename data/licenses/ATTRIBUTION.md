# Attribution

## Game data

Creature, hazard and reference data is extracted from the **Pathfinder Second
Edition system for Foundry Virtual Tabletop**
(<https://github.com/foundryvtt/pf2e>), pinned at the commit recorded in
`tools/build-data/upstream.lock.json`. That project's own source code is licensed
under Apache 2.0; the game data it packages is licensed under the ORC License or
the Open Game License 1.0a, per entry.

Off-Guard uses only the extracted data. It ships none of the upstream code.

## Paizo compatibility statement

> This product is not affiliated with, endorsed, sponsored, or specifically
> approved by Paizo Inc. Off-Guard uses trademarks and/or copyrights owned by
> Paizo Inc., used under Paizo's Community Use Policy
> (<https://paizo.com/communityuse>). We are expressly prohibited from charging
> you to use or access this content. Off-Guard is not published, endorsed, or
> specifically approved by Paizo Inc. For more information about Paizo Inc. and
> Paizo products, visit <https://paizo.com>.

Pathfinder and the Pathfinder logo are registered trademarks of Paizo Inc.

## In-app notice

The footer must render, for whatever entry is on screen, the licence recorded on
that entry (`source.license`), the source book (`source.book`), and the
compatibility statement above. It is not sufficient to state one licence for the
whole application: the bundled data is split between ORC and OGL 1.0a.
