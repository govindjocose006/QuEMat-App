// Catalog metadata only. No application rows or credentials are read here.
import type { SQL } from "../server/db.js";
export const chemicalTables = [
  "chemical_orders",
  "chemical_order_events",
  "chemical_deliveries",
];
export async function orderCatalog(tx: SQL) {
  const tables = await tx.query(
    `SELECT relname AS name,relkind::text AS kind,relrowsecurity AS rls FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]) ORDER BY relname`,
    [[...chemicalTables, "chemical_order_number"]],
  );
  const columns = await tx.query(
    `SELECT c.relname AS relation,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,COALESCE(pg_get_expr(d.adbin,d.adrelid),'') AS expression,a.attidentity::text AS identity,a.attgenerated::text AS generated FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped AND (c.relname=ANY($1::text[]) OR (c.relname='notifications' AND a.attname='order_id')) ORDER BY c.relname,a.attnum`,
    [chemicalTables],
  );
  const constraints = await tx.query(
    `SELECT c.relname AS relation,k.conname AS name,k.contype::text AS kind,k.convalidated AS valid,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='public'::regnamespace AND (c.relname=ANY($1::text[]) OR (c.relname='notifications' AND k.conname IN ('notifications_order_id_fkey','notification_source'))) ORDER BY c.relname,k.conname`,
    [chemicalTables],
  );
  const indexes = await tx.query(
    `SELECT c.relname AS relation,n.relname AS name,i.indisvalid AS valid,i.indisready AS ready,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class n ON n.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname,n.relname`,
    [chemicalTables],
  );
  const functions = await tx.query(
    `SELECT proname AS name,pg_get_function_identity_arguments(oid) AS arguments,replace(prosrc,chr(13)||chr(10),chr(10)) AS body,prosecdef AS definer,proconfig AS settings,prorettype::regtype::text AS returns,provolatile::text AS volatility FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('protect_chemical_identity','protect_chemical_history') ORDER BY proname,arguments`,
  );
  const triggers = await tx.query(
    `SELECT c.relname AS relation,t.tgname AS name,t.tgenabled::text AS enabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    [chemicalTables],
  );
  const sequences = await tx.query(
    `SELECT c.relname AS name,format_type(s.seqtypid,NULL) AS type,s.seqstart::text AS start,s.seqincrement::text AS increment,s.seqmin::text AS min,s.seqmax::text AS max,s.seqcache::text AS cache,s.seqcycle AS cycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid WHERE c.relnamespace='public'::regnamespace AND c.relname='chemical_order_number'`,
  );
  return {
    tables,
    columns,
    constraints,
    indexes,
    functions,
    triggers,
    sequences,
  };
}
export type ChemicalCatalog = Awaited<ReturnType<typeof orderCatalog>>;
