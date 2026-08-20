# Reachable Shots Invariant

## Reader and goal

This note is for future gameplay engineers. After reading it, they should be able to tell whether a rally shot is valid, understand why the solver may adjust a shot, and know what regression tests protect this behavior.

## Problem

Some short net and corner shots looked reachable in play, but the authority simulation could schedule contact after the ball had already bounced a second time or after the ball had fallen below the tabletop. That let the bot appear to hit the ball, then immediately produce an `OUT` point from a physically invalid contact.

The fix changes the rule from “award a point when a shot becomes impossible” to “never generate impossible rally shots.” Player and bot inputs are still accepted, but the trajectory is adjusted before it enters the authoritative ball plan.

## New invariant

Every generated rally shot must have:

1. A first bounce on the receiver side of the table.
2. A planned receiver contact before the second bounce.
3. Contact at playable height: at or above ball radius, and below max contact height.
4. Contact inside the receiver movement lane plus racket reach.
5. No hit resolved from a late simulation tick that samples the ball below the table.

If a raw input would violate any of these, it is not installed as-is.

## What changed

### Contact planning now stops before the second bounce

The rally planner computes the next ground bounce after the first table bounce. Receiver contact candidates are only considered before that time. This prevents “hit after two bounces” plans.

### Contact must be above the table

The old planner allowed contact down to the generic minimum contact height. That value was below the tabletop, so low net shots could produce contact events with the ball already underground. Contact now must be at least ball-radius height.

### Contact must be reachable horizontally

The planner checks candidate contact points against the receiver movement range plus racket reach. Wide side-spin paths can still be playable, but the planned contact must be inside the reachable lane.

### The solver adjusts bad shots before launch

The reachable-shot solver now validates the whole rally result, not just the first bounce. If the raw shot would be unreachable, it retries safer variants:

- reduce side spin;
- reduce top-spin extremes;
- add a little flight time / arc;
- move net-depth shots slightly deeper when needed;
- pull extreme horizontal targets inward only as much as needed.

For corrected rally shots, the solver also keeps planned contact about 0.25m inside the theoretical max reach. This avoids “barely corrected” balls that are technically reachable only when the receiver stands fully on the side edge.

Already reachable shots stay unchanged.

### Hits use exact planned contact

When the simulation processes a contact event, it resolves the return from that event position and time. It no longer samples the current tick time, which could be a few milliseconds later and below the table for very low shots.

## Result

The known bad shots are now playable instead of exploitable:

- middle, no-force, short net aim;
- all-right to left net/corner without force;
- all-right to left net/corner with force;
- high side-spin corner attempts.

The bot can return these when positioned correctly. If a player tries to create an impossible angle, the solver bends the resulting trajectory into the closest reachable version rather than installing an impossible plan.

## Regression coverage

The reachability tests now assert that generated rally shots:

- always create a receiver contact;
- never contact below the table;
- never contact outside max reach;
- keep corrected edge contacts inside a safer reach threshold;
- keep first bounces on the intended receiver side;
- avoid the previous bot-hit-then-`OUT` bug for short net shots.

The server room tests also keep reachable shots unchanged and verify legal side-spin corner shots are not pulled inward unnecessarily.
