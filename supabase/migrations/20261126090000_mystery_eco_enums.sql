-- EcoMap 7a: new ledger entry types (own migration: a new enum value cannot be used in the same transaction).
alter type public.points_transaction_type add value if not exists 'mystery_bonus'; -- Gizli Hazine bonus on top of a reward
alter type public.points_transaction_type add value if not exists 'eco_walk';      -- Eko-Ulaşım: yürüyüş
alter type public.points_transaction_type add value if not exists 'eco_bike';      -- Eko-Ulaşım: bisiklet sürüşü
