import {
    defineServer,
    defineRoom,
    monitor,
    playground,
    createRouter,
    createEndpoint,
} from "colyseus";
import express from "express";
import path from "node:path";

/**
 * Import your Room files
 */
import { RallyRoom } from "./rooms/RallyRoom.js";

const server = defineServer({
    /**
     * Define your room handlers:
     */
    rooms: {
        rally: defineRoom(RallyRoom).filterBy(["mode"])
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
        app.get("/hi", (req, res) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        /**
         * Use @colyseus/monitor
         * It is recommended to protect this route with a password
         * Read more: https://docs.colyseus.io/tools/monitoring/#restrict-access-to-the-panel-using-a-password
         */
        app.use("/monitor", monitor());

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
                if (req.path.startsWith("/api") || req.path.startsWith("/monitor")) return next();
                res.sendFile(path.join(clientDist, "index.html"));
            });
        }
    }

});

export default server;