//! Ensaio somente em uma cópia de QA marcada, nunca no banco principal.
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};
fn quoted(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}
fn fingerprint(c: &Connection, table: &str, columns: &[String]) -> Result<(u64, Vec<u8>), String> {
    let expressions = columns
        .iter()
        .map(|s| format!("quote({})", quoted(s)))
        .collect::<Vec<_>>()
        .join(" || char(31) || ");
    let sql = format!("SELECT {expressions} FROM {} ORDER BY 1", quoted(table));
    let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut count = 0u64;
    for row in rows {
        let value = row.map_err(|e| e.to_string())?;
        hash.update((value.len() as u64).to_le_bytes());
        hash.update(value.as_bytes());
        count += 1;
    }
    Ok((count, hash.finalize().to_vec()))
}
pub fn run(dir: &Path) -> Result<(), String> {
    let root = std::env::current_dir()
        .and_then(|p| p.canonicalize())
        .map_err(|e| e.to_string())?;
    let target = dir.canonicalize().map_err(|e| e.to_string())?;
    let relative = target
        .strip_prefix(&root)
        .map_err(|_| "A cópia deve ficar no workspace.")?;
    if !relative
        .components()
        .next()
        .is_some_and(|c| c.as_os_str().to_string_lossy().starts_with("qa-"))
        || !target.join(".migration-qa").is_file()
    {
        return Err("Só é permitido migrar a cópia marcada dentro de qa-*.".into());
    }
    let file = target
        .join("sancord.db")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if file.parent() != Some(target.as_path()) {
        return Err("O banco deve pertencer à pasta de QA.".into());
    }
    let read = || {
        Connection::open_with_flags(&file, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())
    };
    let c = read()?;
    let before: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut old = BTreeMap::new();
    {
        let mut tables=c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map_err(|e|e.to_string())?;
        for table in tables
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
        {
            let table = table.map_err(|e| e.to_string())?;
            let mut stmt = c
                .prepare(&format!("PRAGMA table_info({})", quoted(&table)))
                .map_err(|e| e.to_string())?;
            let columns = stmt
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            let digest = fingerprint(&c, &table, &columns)?;
            old.insert(table, (columns, digest));
        }
    }
    drop(c);
    let (db, _) = sancord::db::Db::open(&file, None).map_err(|e| e.to_string())?;
    db.shutdown();
    drop(db);
    let c = read()?;
    let after: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if after != sancord::db::SCHEMA_VERSION {
        return Err("Versão final incorreta.".into());
    }
    for (table, (columns, digest)) in &old {
        if fingerprint(&c, table, columns)? != *digest {
            return Err(format!("Dados antigos alterados em {table}."));
        }
    }
    let integrity: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if integrity != "ok" {
        return Err("A verificação de integridade falhou.".into());
    }
    println!("Migração da cópia: v{before} → v{after}; {} tabelas antigas preservadas por hash; integridade OK.",old.len());
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn rejects_primary_data_directory() {
        assert!(super::run(std::path::Path::new("data")).is_err());
    }
}
