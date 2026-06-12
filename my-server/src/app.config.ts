import {
    defineServer,
    defineRoom,
    monitor,
    playground,
    createRouter,
    createEndpoint,
} from "colyseus";
import { auth } from "@colyseus/auth";
import express from "express";
import path from "node:path";

/**
 * Import your Room files
 */
import { BackspinRoom } from "./rooms/BackspinRoom.js";
import { RankedQueueRoom } from "./rooms/RankedQueueRoom.js";
import { authUserFromToken, configureAuth } from "./auth/config.js";
import { rankedStore } from "./ranked/store.js";
import { matchStore, type MatchSummary } from "./matches/store.js";

configureAuth();

async function optionalAuthUser(req: any) {
    const header = String(req.headers?.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return null;
    try {
        return await authUserFromToken(token);
    } catch {
        return null;
    }
}

function canReadMatch(match: MatchSummary, user: any) {
    if (!match.ranked) return true;
    return Boolean(user?.id && (match.p1UserId === user.id || match.p2UserId === user.id));
}

async function sendMatchResource(req: any, res: any, load: () => Promise<any>) {
    try {
        const resource = await load();
        if (!resource) return res.status(404).json({ error: "match_not_found" });
        const user = await optionalAuthUser(req);
        if (!canReadMatch(resource.match, user)) return res.status(403).json({ error: "match_forbidden" });
        res.json(resource);
    } catch (error: any) {
        res.status(500).json({ error: error?.message || "match_lookup_failed" });
    }
}

const server = defineServer({
    /**
     * Define your room handlers:
     */
    rooms: {
        backspin: defineRoom(BackspinRoom).filterBy(["mode"]),
        ranked_queue: defineRoom(RankedQueueRoom),
    },

    /**
     * Experimental: Define API routes. Built-in integration with the "playground" and SDK.
     * 
     * Usage from SDK: 
     *   client.http.get("/api/hello").then((response) => {})
     * 
     */
    routes: createRouter({
        api_hello: createEndpoint("/api/hello", { method: "GET", }, async (ctx) => {
            return { message: "Hello World" }
        })
    }),

    /**
     * Bind your custom express routes here:
     * Read more: https://expressjs.com/en/starter/basic-routing.html
     */
    express: (app) => {
        app.use(express.json());
        app.use(auth.prefix, auth.routes());

        app.get("/api/me/rank", auth.middleware(), async (req: any, res: any) => {
            try {
                const profile = await rankedStore.getProfile(req.auth.id);
                res.json({ profile });
            } catch (error: any) {
                res.status(401).json({ error: error?.message || "unauthorized" });
            }
        });

        app.patch("/api/me/name", auth.middleware(), async (req: any, res: any) => {
            try {
                const user = await rankedStore.updateUserName(req.auth.id, req.body?.name);
                const profile = await rankedStore.getProfile(req.auth.id);
                res.json({ user: { id: user.id, email: user.email, name: user.name }, profile });
            } catch (error: any) {
                res.status(400).json({ error: error?.message || "name_update_failed" });
            }
        });

        app.get("/api/me/matches", auth.middleware(), async (req: any, res: any) => {
            try {
                const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
                const offset = Math.max(0, Number(req.query.offset) || 0);
                const matches = await matchStore.listMatchesForUser(req.auth.id, limit, offset);
                res.json({ matches, nextOffset: matches.length === limit ? offset + limit : null });
            } catch (error: any) {
                res.status(400).json({ error: error?.message || "matches_lookup_failed" });
            }
        });

        app.get("/api/me/stats", auth.middleware(), async (req: any, res: any) => {
            try {
                res.json({ stats: await matchStore.getUserStats(req.auth.id) });
            } catch (error: any) {
                res.status(400).json({ error: error?.message || "stats_lookup_failed" });
            }
        });

        app.get("/api/leaderboard", async (req, res) => {
            const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
            res.json({ leaderboard: await rankedStore.leaderboard(limit) });
        });


        app.get("/api/matches/:matchId", async (req, res) => {
            await sendMatchResource(req, res, () => matchStore.getMatchDetails(req.params.matchId));
        });

        app.get("/api/matches/:matchId/replay", async (req, res) => {
            await sendMatchResource(req, res, () => matchStore.getReplay(req.params.matchId));
        });

        app.get("/api/matches/:matchId/shots/:shotId/replay", async (req, res) => {
            await sendMatchResource(req, res, () => matchStore.getShotReplay(req.params.matchId, req.params.shotId));
        });

        app.get("/healthz", (req, res) => {
            res.status(200).json({ ok: true });
        });

        app.use((error: any, _req: any, res: any, next: any) => {
            if (error?.name === "UnauthorizedError") return res.status(401).json({ error: "unauthorized" });
            next(error);
        });

        if (process.env.ENABLE_MONITOR === "true") {
            app.use("/monitor", monitor());
        }

        /**
         * Use @colyseus/playground
         * (It is not recommended to expose this route in a production environment)
         */
        if (process.env.NODE_ENV !== "production") {
            app.use("/", playground());
        }

        if (process.env.NODE_ENV === "production") {
            const clientDist = process.env.CLIENT_DIST_DIR || path.resolve(process.cwd(), "../dist");
            app.use(express.static(clientDist));
            app.get("*", (req, res, next) => {
                if (req.path.startsWith("/api") || req.path.startsWith("/healthz") || req.path.startsWith("/monitor")) return next();
                res.sendFile(path.join(clientDist, "index.html"));
            });
        }
    }

});

export default server;
