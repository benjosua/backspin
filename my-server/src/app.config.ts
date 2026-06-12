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
import { configureAuth } from "./auth/config.js";
import { rankedStore } from "./ranked/store.js";

configureAuth();

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
        app.use(auth.prefix, auth.routes());

        app.get("/api/me/rank", auth.middleware(), async (req: any, res: any) => {
            try {
                const profile = await rankedStore.getProfile(req.auth.id);
                res.json({ profile });
            } catch (error: any) {
                res.status(401).json({ error: error?.message || "unauthorized" });
            }
        });

        app.get("/api/leaderboard", async (req, res) => {
            const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
            res.json({ leaderboard: await rankedStore.leaderboard(limit) });
        });

        app.get("/healthz", (req, res) => {
            res.status(200).json({ ok: true });
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
