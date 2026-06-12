import { Client, ErrorCode, matchMaker, QueueRoom, ServerError } from "colyseus";
import { authUserFromToken, type AuthUser } from "../auth/config.js";
import { rankedStore } from "../ranked/store.js";

const MAX_RANK_DIFF = 150;

type QueueClient = Client<{ userData: any }>;

export class RankedQueueRoom extends QueueRoom {
  static async onAuth(_token: string, _options: any, context: any) {
    const user = await authUserFromToken(context?.token);
    if (!user) throw new ServerError(ErrorCode.AUTH_FAILED, "ranked_requires_sign_in");
    return user;
  }

  onCreate(_options: any) {
    super.onCreate({
      matchRoomName: "backspin",
      maxPlayers: 2,
      maxWaitingCyclesForPriority: 20,
      compare: (client: any, group: any) => Math.abs(client.rank - group.averageRank) <= MAX_RANK_DIFF,
      onGroupReady: async (group: any) => matchMaker.createRoom("backspin", {
        ranked: true,
        mode: "ranked",
        averageRank: Math.round(group.averageRank),
      }),
    });
  }

  async onJoin(client: QueueClient, options: any, auth: AuthUser) {
    const profile = await rankedStore.getProfile(auth.id);
    this.addToQueue(client, {
      rank: profile.rating,
      options: {
        ...options,
        ranked: true,
        mode: "ranked",
        name: auth.name,
      },
    });
  }
}
