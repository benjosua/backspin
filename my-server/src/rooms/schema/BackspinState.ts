import { Schema, type } from "@colyseus/schema";

export class BackspinState extends Schema {
  @type("string") roomCode = "";
  @type("string") mode = "public";
  @type("boolean") ranked = false;
  @type("string") phase = "waiting";
  @type("string") server = "p1";
  @type("string") winner = "";
  @type("string") p1 = "";
  @type("string") p2 = "";
  @type("string") p1Name = "YOU";
  @type("string") p2Name = "OPPONENT";
  @type("number") scoreP1 = 0;
  @type("number") scoreP2 = 0;
  @type("number") ballX = 0;
  @type("number") ballY = 0.34;
  @type("number") ballZ = 0;
  @type("number") ballVx = 0;
  @type("number") ballVy = 0;
  @type("number") ballVz = 0;
  @type("number") spinTop = 0;
  @type("number") spinSide = 0;
  @type("number") p1X = 0;
  @type("number") p2X = 0;
  @type("number") p1Charge = 0;
  @type("number") p2Charge = 0;
  @type("number") exchange = 0;
  @type("number") pointSeq = 0;
  @type("string") pointWinner = "";
  @type("string") pointReason = "";
  @type("number") joined = 0;
}
