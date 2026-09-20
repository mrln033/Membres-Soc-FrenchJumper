const NICKNAME_PERMISSION_WARNING =
  "Les rôles Discord ont bien été synchronisés. Le pseudonyme n'a pas été modifié, car le rôle du bot FrenchJumper est placé sous le rôle le plus élevé de ce membre dans la hiérarchie Discord.";

export async function syncDiscordRolesAndNickname({
  discordId,
  guildId,
  niveau,
  nomAvatar,
  roles,
  requestDiscord
}) {
  const rolesToAdd = [];
  const rolesToRemove = [];

  if (niveau >= 1 && niveau <= 6) {
    rolesToAdd.push(roles.ROLE_FRJ, roles[`GRADE${niveau}`]);

    for (let i = 1; i <= 6; i++) {
      if (i !== niveau) rolesToRemove.push(roles[`GRADE${i}`]);
    }
  } else {
    rolesToRemove.push(roles.ROLE_FRJ);
    for (let i = 1; i <= 6; i++) rolesToRemove.push(roles[`GRADE${i}`]);
  }

  try {
    for (const roleId of rolesToRemove) {
      await requestDiscord(
        `/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
        { method: "DELETE" }
      );
    }

    for (const roleId of rolesToAdd) {
      await requestDiscord(
        `/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
        { method: "PUT" }
      );
    }
  } catch (error) {
    return {
      success: false,
      failedStep: "roles",
      error: `Synchronisation des rôles Discord impossible : ${errorMessage(error)}`
    };
  }

  if (!nomAvatar) {
    return { success: true, nicknameUpdated: false };
  }

  try {
    await requestDiscord(
      `/guilds/${guildId}/members/${discordId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nick: nomAvatar.slice(0, 32) })
      }
    );
    return { success: true, nicknameUpdated: true };
  } catch (error) {
    const details = errorMessage(error);
    const permissionRefused = /(?:HTTP 403|Missing Permissions|"code"\s*:\s*50013)/i.test(details);

    return {
      success: true,
      nicknameUpdated: false,
      warningCode: permissionRefused ? "NICKNAME_PERMISSION_REFUSED" : "NICKNAME_UPDATE_FAILED",
      warning: permissionRefused
        ? NICKNAME_PERMISSION_WARNING
        : `Les rôles Discord ont bien été synchronisés, mais le pseudonyme n'a pas pu être modifié : ${details}`
    };
  }
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}
