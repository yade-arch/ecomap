-- EcoMap 6a: new ledger entry types for EARTHCARE.
-- Kept in its own migration: a value added with ALTER TYPE ... ADD VALUE cannot be used
-- in the same transaction, and every migration file runs in one transaction.

alter type public.points_transaction_type add value if not exists 'municipal_adjustment'; -- +/- by a municipality admin
alter type public.points_transaction_type add value if not exists 'municipal_set';        -- "set to N" by a municipality admin
alter type public.points_transaction_type add value if not exists 'reward_redeem';        -- EcoPuan spent on a reward
