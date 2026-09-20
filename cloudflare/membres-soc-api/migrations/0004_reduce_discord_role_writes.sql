-- La clé primaire (member_id, discord_role_id) couvre déjà les recherches
-- par member_id. Cet index redondant doublait le coût d'écriture des liens.
DROP INDEX IF EXISTS idx_member_discord_roles_member;

PRAGMA optimize;
