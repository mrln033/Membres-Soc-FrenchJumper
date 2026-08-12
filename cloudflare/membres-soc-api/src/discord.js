const DISCORD_API = "https://discord.com/api/v10";
const MAX_ERROR_BYTES = 2_000;

export async function removeDiscordRole({ discordId, guildId, roleId, botToken }, fetcher = fetch) {
  const member = String(discordId || "").trim();
  const guild = String(guildId || "").trim();
  const role = String(roleId || "").trim();

  if (!/^\d{17,20}$/.test(member)) throw new Error("Identifiant Discord invalide");
  if (!/^\d{17,20}$/.test(guild)) throw new Error("DISCORD_GUILD_ID invalide ou manquant");
  if (!/^\d{17,20}$/.test(role)) throw new Error("Identifiant du rôle Discord invalide");
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN manquant");

  const response = await fetcher(
    `${DISCORD_API}/guilds/${guild}/members/${member}/roles/${role}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bot ${botToken}` }
    }
  );

  if (!response.ok) {
    const details = await readBoundedText(response.body, MAX_ERROR_BYTES);
    throw new Error(`Discord HTTP ${response.status}: ${details}`);
  }

  return { success: true, roleId: role };
}

async function readBoundedText(body, limit) {
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel("Payload too large");
      return "Réponse Discord trop volumineuse";
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}
