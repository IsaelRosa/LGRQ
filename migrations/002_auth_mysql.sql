-- ---------------------------------------------------------------------
-- LGRP · migração 002 — autenticação própria em MySQL/MariaDB
--
-- Execute APENAS em instalações que JÁ possuem as tabelas criadas pela
-- versão anterior do lgrp_mysql.sql. Em uma instalação nova, basta importar
-- o lgrp_mysql.sql completo, que já inclui a coluna senha_hash.
--
--   mysql -u USUARIO -p NOME_DO_BANCO < migrations/002_auth_mysql.sql
-- ---------------------------------------------------------------------

SET NAMES utf8mb4;

-- Hash scrypt da senha no formato scrypt$N$r$p$salt$hash.
ALTER TABLE `usuarios`
  ADD COLUMN IF NOT EXISTS `senha_hash` VARCHAR(255) NULL
  COMMENT 'scrypt$N$r$p$salt$hash' AFTER `ativo`;

-- Usuários herdados do modelo antigo (Supabase) continuam sem senha e,
-- portanto, sem login. Defina a senha do administrador com:
--   npm run seed -- --email admin@lgrp.edu.br --senha SUA_SENHA
-- ou, para um usuário já existente:
--   npm run seed -- --email usuario@exemplo.br --senha SUA_SENHA
