-- Natures de question supplementaires, calquees sur le jeu de GLPI.
--
-- `ALTER TYPE ... ADD VALUE` ne peut pas s'executer dans une transaction en
-- PostgreSQL avant la version 12 ; il le peut depuis, ce qui permet de les
-- ajouter ici sans decouper la migration.
--
-- `IF NOT EXISTS` rend la migration rejouable : une base deja passee par une
-- version intermediaire ne casse pas.

ALTER TYPE "form_question_kind" ADD VALUE IF NOT EXISTS 'time';
ALTER TYPE "form_question_kind" ADD VALUE IF NOT EXISTS 'datetime';
ALTER TYPE "form_question_kind" ADD VALUE IF NOT EXISTS 'email';
ALTER TYPE "form_question_kind" ADD VALUE IF NOT EXISTS 'url';
ALTER TYPE "form_question_kind" ADD VALUE IF NOT EXISTS 'radio';
ALTER TYPE "form_question_kind" ADD VALUE IF NOT EXISTS 'requesttype';
ALTER TYPE "form_question_kind" ADD VALUE IF NOT EXISTS 'description';
