[![make.fun bounty](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/shiny4-cyber/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/shiny4-cyber/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

# sokoban-solver

A push-optimal Sokoban solver for make.fun's
[Build the best Sokoban solver](https://make.fun/bounty/sokoban-solver-01-run-20261121) bounty. It reads
`/input/<id>/level.txt` (XSB) and writes the player's moves to `/output/<id>/solution.txt` in LURD, one
letter a step (a push in upper case; the replayer decides).

## How it solves

A level is a hallway one square wide, where the player starts, with one to four rooms off it. A box pushed
into the hallway can never be pushed back, so every box stays in its room and a level's push optimum is the
sum of its rooms' optima. The solver marks the dead squares (a box alone cannot be pushed from there to a
goal) by pulling back from the goals, cuts the hallway's dead squares out of the floor to split the level into
its rooms, and answers each room on its own:

1. one breadth-first search over pushes: a state is the boxes' squares plus the player's reachable region,
   named by its lowest square, and every push costs one, so the first solved state met is push-optimal;
2. pruned by what no push can save: dead squares, and a frozen 2 x 2 block of walls and boxes with a box off
   its goal;
3. the player's walks between pushes are shortest paths, played before each push.

A level of another shape is searched whole. The budget is states, never the clock: no randomness, no wall
clock, ties by square order, so two runs write the same bytes.

## Run

    node main.ts
    MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts

Node 22.18 or later runs the TypeScript as it is.

## Results

Practice set: all five instances at their push-optimal count P* (13, 16, 29, 47, 60 pushes), score 1,000,000
of 1,000,000. On 420 further levels drawn by the kit's own generator (all five size classes, up to four rooms
of four boxes), every level is answered at P* and none unanswered. A room's search expands about 3,000 states
typically and 12,300 at most, against a cap of 200,000, so a set runs in seconds under the 60-second wall.

## Licence

MIT. See `LICENSE`.
