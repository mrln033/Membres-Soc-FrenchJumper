import { env } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";
const DEFAULT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzf40jOrUs79_O5PASuc7Y-OOZv_C2RZV1bY7r97WhF8iVVQ6f4nIpBCCRh_0IOIozSew/exec";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/sync") {
      return handleDiscordSync(request);
    }

    return handleDiscordInteraction(request);
  }
};

async function handleDiscordSync(request) {
  let data;

  try {
    data = await request.json();
  } catch (err) {
    return jsonResponse({ success: false, error: "JSON invalide" }, 400);
  }

  if (!env.SECRET || data.secret !== env.SECRET) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 403);
  }

  const discordId = String(data.discordId || "").trim();
  const niveau = Number(data.niveau);
  const nomAvatar = String(data.nomAvatar || "").trim();

  if (!/^\d{17,20}$/.test(discordId)) {
    return jsonResponse({ success: false, error: "Identifiant Discord invalide" }, 400);
  }

  if (!Number.isInteger(niveau) || niveau < 0 || niveau > 6) {
    return jsonResponse({ success: false, error: "Niveau invalide" }, 400);
  }

  const config = getDiscordConfig();
  if (config.error) {
    return jsonResponse({ success: false, error: config.error }, 500);
  }

  console.log("Synchronisation Discord", {
    discordId: discordId,
    niveau: niveau,
    nomAvatar: nomAvatar
  });

  const rolesToAdd = [];
  const rolesToRemove = [];

  if (niveau >= 1 && niveau <= 6) {
    rolesToAdd.push(config.roles.ROLE_FRJ);
    rolesToAdd.push(config.roles[`GRADE${niveau}`]);

    for (let i = 1; i <= 6; i++) {
      if (i !== niveau) {
        rolesToRemove.push(config.roles[`GRADE${i}`]);
      }
    }
  } else {
    rolesToRemove.push(config.roles.ROLE_FRJ);
    for (let i = 1; i <= 6; i++) {
      rolesToRemove.push(config.roles[`GRADE${i}`]);
    }
  }

  try {
    for (const roleId of rolesToRemove) {
      await discordRequest(
        `/guilds/${config.guildId}/members/${discordId}/roles/${roleId}`,
        { method: "DELETE" },
        config.botToken
      );
    }

    for (const roleId of rolesToAdd) {
      await discordRequest(
        `/guilds/${config.guildId}/members/${discordId}/roles/${roleId}`,
        { method: "PUT" },
        config.botToken
      );
    }

    if (nomAvatar) {
      await discordRequest(
        `/guilds/${config.guildId}/members/${discordId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nick: nomAvatar.slice(0, 32) })
        },
        config.botToken
      );
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("Synchronisation Discord échouée", err.message);
    return jsonResponse({ success: false, error: err.message }, 502);
  }
}

async function handleDiscordInteraction(request) {
  const publicKey = env.DISCORD_PUBLIC_KEY;

  if (!publicKey) {
    return new Response("Missing DISCORD_PUBLIC_KEY", { status: 500 });
  }

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const body = await request.text();

  if (!signature || !timestamp) {
    return new Response("Missing signature", { status: 401 });
  }

  try {
    const encoder = new TextEncoder();
    const signedData = encoder.encode(timestamp + body);
    const sig = hexToUint8Array(signature);
    const key = hexToUint8Array(publicKey);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["verify"]
    );

    const isValid = await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      sig,
      signedData
    );

    if (!isValid) {
      return new Response("Bad signature", { status: 401 });
    }
  } catch (err) {
    console.error("Vérification de signature impossible", err.message);
    return new Response("Bad signature", { status: 401 });
  }

  let interaction;

  try {
    interaction = JSON.parse(body);
  } catch (err) {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (interaction.type === 1) {
    return jsonResponse({ type: 1 });
  }

  const appsScriptUrl = env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;
  const response = await fetch(appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body
  });

  if (!response.ok) {
    console.error(
      "Apps Script a refusé l'interaction",
      response.status,
      (await response.clone().text()).slice(0, 500)
    );
  }

  return response;
}

function getDiscordConfig() {
  const roles = {
    ROLE_FRJ: env.ROLE_FRJ,
    GRADE1: env.ROLE_GRADE1,
    GRADE2: env.ROLE_GRADE2,
    GRADE3: env.ROLE_GRADE3,
    GRADE4: env.ROLE_GRADE4,
    GRADE5: env.ROLE_GRADE5,
    GRADE6: env.ROLE_GRADE6
  };

  const missing = [];

  if (!env.BOT_TOKEN) missing.push("BOT_TOKEN");
  if (!env.GUILD_ID) missing.push("GUILD_ID");

  for (const [name, value] of Object.entries(roles)) {
    if (!value) missing.push(name === "ROLE_FRJ" ? name : `ROLE_${name}`);
  }

  if (missing.length) {
    return { error: "Configuration Worker manquante : " + missing.join(", ") };
  }

  return {
    botToken: env.BOT_TOKEN,
    guildId: env.GUILD_ID,
    roles: roles
  };
}

async function discordRequest(path, options, botToken) {
  const response = await fetch(DISCORD_API + path, {
    ...options,
    headers: {
      Authorization: `Bot ${botToken}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Discord HTTP ${response.status}: ${details}`);
  }

  return response;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { "Content-Type": "application/json; charset=UTF-8" }
  });
}

function hexToUint8Array(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Valeur hexadécimale invalide");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
