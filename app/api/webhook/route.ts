import { sendFrameNotification } from "@/lib/notification-client";
import { log } from "@/lib/logger";
import {
  deleteUserNotificationDetails,
  setUserNotificationDetails,
} from "@/lib/notifications";
import { createPublicClient, http } from "viem";
import { optimism } from "viem/chains";

const KEY_REGISTRY_ADDRESS = "0x00000000Fc1237824fb747aBDE0FF18990E59b7e";

const KEY_REGISTRY_ABI = [
  {
    inputs: [
      { name: "fid", type: "uint256" },
      { name: "key", type: "bytes" },
    ],
    name: "keyDataOf",
    outputs: [
      {
        components: [
          { name: "state", type: "uint8" },
          { name: "keyType", type: "uint32" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const optimismClient = createPublicClient({
  chain: optimism,
  transport: http(),
});

async function verifyFidOwnership(fid: number, appKey: `0x${string}`) {
  try {
    const result = await optimismClient.readContract({
      address: KEY_REGISTRY_ADDRESS,
      abi: KEY_REGISTRY_ABI,
      functionName: "keyDataOf",
      args: [BigInt(fid), appKey],
    });

    return result.state === 1 && result.keyType === 1;
  } catch (error) {
    log.error("Key Registry verification failed", {
      err: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function decodeBase64Json(encoded: string) {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    header: string;
    payload: string;
  };

  const { fid, key } = decodeBase64Json(body.header);
  const event = decodeBase64Json(body.payload);

  if (!(await verifyFidOwnership(fid, key))) {
    return Response.json(
      { success: false, error: "Invalid FID ownership" },
      { status: 401 },
    );
  }

  switch (event.event) {
    case "frame_added": {
      log.info("frame_added", {
        fid,
        hasNotificationDetails: Boolean(event.notificationDetails),
      });
      if (event.notificationDetails) {
        await setUserNotificationDetails(fid, event.notificationDetails);
        await sendFrameNotification({
          fid,
          title: `Welcome to the arena`,
          body: `Fund your wallet and cast a command to begin.`,
        });
      } else {
        await deleteUserNotificationDetails(fid);
      }
      break;
    }
    case "frame_removed": {
      log.info("frame_removed", { fid });
      await deleteUserNotificationDetails(fid);
      break;
    }
    case "notifications_enabled": {
      log.info("notifications_enabled", { fid });
      await setUserNotificationDetails(fid, event.notificationDetails);
      await sendFrameNotification({
        fid,
        title: `Notifications armed`,
        body: `We'll ping you when your trades score and when your rank shifts.`,
      });
      break;
    }
    case "notifications_disabled": {
      log.info("notifications_disabled", { fid });
      await deleteUserNotificationDetails(fid);
      break;
    }
  }

  return Response.json({ success: true });
}
