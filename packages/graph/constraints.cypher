// Uniqueness constraints (one per node label, on its key) and the lookup indexes the API uses.
// Applied by `npm run load` before any data is written. Safe to re-run.

CREATE CONSTRAINT item_part_number IF NOT EXISTS FOR (n:Item) REQUIRE n.partNumber IS UNIQUE;
CREATE CONSTRAINT item_type_code IF NOT EXISTS FOR (n:ItemType) REQUIRE n.code IS UNIQUE;
CREATE CONSTRAINT factor_code_code IF NOT EXISTS FOR (n:FactorCode) REQUIRE n.code IS UNIQUE;
CREATE CONSTRAINT conversion_code_code IF NOT EXISTS FOR (n:ConversionCode) REQUIRE n.code IS UNIQUE;
CREATE CONSTRAINT category_key IF NOT EXISTS FOR (n:Category) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT zip_tax_zip IF NOT EXISTS FOR (n:ZipTax) REQUIRE n.zip IS UNIQUE;
CREATE CONSTRAINT city_tax_key IF NOT EXISTS FOR (n:CityTax) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT vendor_id IF NOT EXISTS FOR (n:Vendor) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT user_id IF NOT EXISTS FOR (n:User) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT customer_name IF NOT EXISTS FOR (n:Customer) REQUIRE n.name IS UNIQUE;
CREATE CONSTRAINT project_name IF NOT EXISTS FOR (n:Project) REQUIRE n.name IS UNIQUE;
CREATE CONSTRAINT architect_id IF NOT EXISTS FOR (n:Architect) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT engineer_id IF NOT EXISTS FOR (n:Engineer) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT bid_id IF NOT EXISTS FOR (n:Bid) REQUIRE n.bidId IS UNIQUE;
CREATE CONSTRAINT sub_bid_id IF NOT EXISTS FOR (n:SubBid) REQUIRE n.subBidId IS UNIQUE;
CREATE CONSTRAINT bid_adjustment_id IF NOT EXISTS FOR (n:BidAdjustment) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT bid_change_order_id IF NOT EXISTS FOR (n:BidChangeOrder) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT job_id IF NOT EXISTS FOR (n:Job) REQUIRE n.jobId IS UNIQUE;
CREATE CONSTRAINT change_order_id IF NOT EXISTS FOR (n:ChangeOrder) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT purchase_order_number IF NOT EXISTS FOR (n:PurchaseOrder) REQUIRE n.poNumber IS UNIQUE;
CREATE CONSTRAINT comment_key IF NOT EXISTS FOR (n:Comment) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT proposal_id IF NOT EXISTS FOR (n:Proposal) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT proposal_recipient_id IF NOT EXISTS FOR (n:ProposalRecipient) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT proposal_component_id IF NOT EXISTS FOR (n:ProposalComponent) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT proposal_amount_id IF NOT EXISTS FOR (n:ProposalAmount) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT proposal_option_id IF NOT EXISTS FOR (n:ProposalOption) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT groundwork_meta_key IF NOT EXISTS FOR (n:GroundworkMeta) REQUIRE n.key IS UNIQUE;

// item search filters on type; category roll-ups read the category stored on each line
CREATE INDEX item_type IF NOT EXISTS FOR (n:Item) ON (n.type);
CREATE INDEX line_category IF NOT EXISTS FOR ()-[r:HAS_LINE]-() ON (r.category);
// free-text item search (the API uses CONTAINS today; this index is ready for db.index.fulltext.queryNodes)
CREATE FULLTEXT INDEX item_text IF NOT EXISTS FOR (n:Item) ON EACH [n.description, n.partNumber];
