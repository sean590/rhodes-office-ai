-- Add missing relationship types to the enum
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'purchase_agreement';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'subscription_agreement';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'operating_agreement';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'trust_agreement';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'consulting';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'insurance';
