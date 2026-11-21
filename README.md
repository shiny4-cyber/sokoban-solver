[![make.fun bounty](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/shiny4-cyber/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/shiny4-cyber/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

# sokoban-solver

A push-optimal Sokoban solver for make.fun's
[Build the best Sokoban solver](https://make.fun/bounty/sokoban-solver-01-run-20261121) bounty.

The program reads every instance under `/input/<id>/level.txt` (XSB), solves it, and writes the player's
moves to `/output/<id>/solution.txt` in LURD, one letter a step (a push in upper case; the replayer decides).

## How it solves

The levels have a hallway one square wide, where the player starts, and rooms off it. A box pushed into the
hallway can never be pushed back, so each box stays in its room and a level's push optimum is the sum of its
rooms' optima. The solver:

1. computes the dead squares (a box alone can never reach a goal from them) and cuts the hallway's dead
   squares out of the floor, which splits the level into its rooms;
2. answers each room with A* over pushes: a state is the boxes' squares plus the player's reachable region,
   the cost a push, and the estimate a minimum-cost assignment of boxes to goals over pushes-ignoring-boxes
   distances (admissible, so the first solved state is push-optimal);
3. prunes what no push can save: dead squares, and a frozen 2 x 2 block of walls and boxes with a box off
   its goal;
4. walks the player between pushes with a shortest-path search and plays each push.

A level that is not that shape is searched whole instead. The search is bounded by states, never by the
clock: no randomness and no wall clock, so two runs write the same bytes.

## Run

```sh
node main.ts            # reads /input/<id>/level.txt, writes /output/<id>/solution.txt
```

Node 22.18 or later runs the TypeScript as it is. Outside a container:

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Result on the practice set

All five practice instances are answered in their push-optimal count P* (13, 16, 29, 47, 60 pushes),
1,000 points each: score 1,000,000 of 1,000,000. The whole set takes well under a second; the states-based
budget leaves a wide margin under the 60-second wall.

## Licence

MIT. See `LICENSE`.
