CREATE UNIQUE INDEX `state_defs_key_by_origin` ON `state_defs` (`version_id`, `key`, ifnull(`origin_turn_id`, ''));
