// Catalog-only load straight from GitHub, for when you have a Neo4j Browser / Aura Query tab
// and nothing else (no Node, no clone). Paste the whole file and run it.
//
// This loads the item catalog: items, types, factor-code kits, conversion codes, labor rates.
// For the full graph (bids, jobs, purchase orders, proposals) use `npm run load -- --reset`,
// which also applies every constraint in constraints.cypher.

CREATE CONSTRAINT item_part_number IF NOT EXISTS FOR (n:Item) REQUIRE n.partNumber IS UNIQUE;
CREATE CONSTRAINT item_type_code IF NOT EXISTS FOR (n:ItemType) REQUIRE n.code IS UNIQUE;
CREATE CONSTRAINT factor_code_code IF NOT EXISTS FOR (n:FactorCode) REQUIRE n.code IS UNIQUE;
CREATE CONSTRAINT conversion_code_code IF NOT EXISTS FOR (n:ConversionCode) REQUIRE n.code IS UNIQUE;
CREATE CONSTRAINT category_key IF NOT EXISTS FOR (n:Category) REQUIRE n.key IS UNIQUE;

:param base => 'https://raw.githubusercontent.com/Crschnicker/hackathon-groundwork/main/data';

LOAD CSV WITH HEADERS FROM $base + '/factor_code.csv' AS r
CALL (r) {
  MERGE (f:FactorCode {code: r.factor_code})
  SET f.description = r.description, f.laborHours = toFloat(r.labor_hours)
} IN TRANSACTIONS OF 2000 ROWS;

LOAD CSV WITH HEADERS FROM $base + '/conversion_code.csv' AS r
CALL (r) {
  MERGE (c:ConversionCode {code: r.code}) SET c.description = r.description
} IN TRANSACTIONS OF 2000 ROWS;

LOAD CSV WITH HEADERS FROM $base + '/labor_rates.csv' AS r
MERGE (c:Category {key: toLower(r.category)}) SET c.laborRate = toFloat(r.rate);

LOAD CSV WITH HEADERS FROM $base + '/inventory.csv' AS r
CALL (r) {
  MERGE (i:Item {partNumber: r.part_number})
  SET i.description = r.description, i.cost = toFloat(r.cost), i.salePrice = toFloat(r.sale_price),
      i.unit = r.unit, i.type = r.type, i.size = r.size, i.costCode = r.cost_code, i.factorCode = r.factor_code
  WITH i, r
  CALL (i, r) {
    WITH i, r WHERE r.type IS NOT NULL
    MERGE (t:ItemType {code: r.type}) ON CREATE SET t.label = r.type
    MERGE (i)-[:OF_TYPE]->(t)
  }
  CALL (i, r) {
    MATCH (f:FactorCode {code: r.factor_code})
    MERGE (i)-[:DEFAULT_FACTOR]->(f)
  }
} IN TRANSACTIONS OF 2000 ROWS;

LOAD CSV WITH HEADERS FROM $base + '/factor_code_items.csv' AS r
CALL (r) {
  MATCH (f:FactorCode {code: r.factor_code})
  MATCH (i:Item {partNumber: r.part_number})
  MERGE (f)-[x:INCLUDES {id: toInteger(r.id)}]->(i) SET x.quantity = toFloat(r.quantity)
} IN TRANSACTIONS OF 2000 ROWS;

LOAD CSV WITH HEADERS FROM $base + '/inventory_conversion_code.csv' AS r
CALL (r) {
  MATCH (i:Item {partNumber: r.inventory_part_number})
  MATCH (c:ConversionCode {code: r.conversion_code})
  MERGE (i)-[x:CONVERTS_WITH]->(c) SET x.quantity = toFloat(r.quantity)
} IN TRANSACTIONS OF 2000 ROWS;

// Friendly names for the type codes
UNWIND [['TR','Tree'],['SH','Shrub'],['GCC','Ground Cover / Color'],['SD','Sod'],['SP','Soil Prep'],['FERT','Fertilizer'],
        ['AMM','Amendments'],['AGG','Aggregates'],['BOL','Boulders'],['GRAV','Gravel'],['HDR','Header'],['TRSTK','Tree Stake'],
        ['FFAB','Filter Fabric'],['POC','Point of Connection'],['PMP','Pump'],['S','Sleeves'],['M','Mainline'],['L','Laterals'],
        ['CV','Control Valve']] AS pair
MATCH (t:ItemType {code: pair[0]}) SET t.label = pair[1];

MATCH (i:Item)-[:OF_TYPE]->(t:ItemType) RETURN t.label AS type, count(i) AS items ORDER BY items DESC;
