//! Perfil — catálogo de cosméticos e posse (fonte de verdade no servidor).
//!
//! Modelo (seções 59, 64–66 e 72 do pedido de perfis):
//! - `CosmeticItem`: id, tipo, nome, coleção, raridade, animado e disponibilidade.
//! - Disponibilidade não é pagamento: "free" (todos), "badge:<id>" (quem tem a badge,
//!   concedida só pelo servidor), "grant" (só por inventário: eventos, presentes, códigos).
//! - Posse = gratuito, ou id em `Account.inventory`, ou badge exigida em `profile.badges`.
//! - O cliente desenha cada item pelo `id` (arte própria em CSS/SVG); o servidor só
//!   aceita equipar o que existe, é do tipo certo e a pessoa possui.
use crate::models::Account;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    AvatarDecoration,
    ProfileFrame,
    ProfileEffect,
    Nameplate,
    NameStyle,
}

#[derive(Debug, Clone, Serialize)]
pub struct CosmeticItem {
    pub id: &'static str,
    pub kind: Kind,
    pub name: &'static str,
    pub collection: &'static str,
    /// "common" | "rare" | "epic" | "legendary" | "event" | "founder"
    pub rarity: &'static str,
    pub animated: bool,
    /// "free" | "badge:<id>" | "grant"
    pub availability: &'static str,
}

const fn item(id: &'static str, kind: Kind, name: &'static str, collection: &'static str, rarity: &'static str, animated: bool, availability: &'static str) -> CosmeticItem {
    CosmeticItem { id, kind, name, collection, rarity, animated, availability }
}

use Kind::*;

/// Primeira leva (já existente no cliente): continua gratuita para todos.
const CLASSIC: &[CosmeticItem] = &[
    item("flame-violet", AvatarDecoration, "Chama Violeta", "classicos", "common", true, "free"),
    item("cat-gamer", AvatarDecoration, "Orelhas de Gato RGB", "classicos", "common", true, "free"),
    item("angel-wings", AvatarDecoration, "Asas Celestiais", "classicos", "common", true, "free"),
    item("devil-horns", AvatarDecoration, "Chifres Infernais", "classicos", "common", true, "free"),
    item("cyber-cyan", AvatarDecoration, "Visor Ciano", "classicos", "common", true, "free"),
    item("sakura-glow", AvatarDecoration, "Pétalas Sakura", "classicos", "common", true, "free"),
    item("golden-halo", AvatarDecoration, "Coroa Estelar", "classicos", "common", true, "free"),
    item("crimson-vortex", AvatarDecoration, "Vórtice Escarlate", "classicos", "common", true, "free"),
    item("rainbow-prism", AvatarDecoration, "Prisma", "classicos", "common", true, "free"),
    item("galaxy-portal", AvatarDecoration, "Portal Galáctico", "classicos", "common", true, "free"),
    item("electric-surge", AvatarDecoration, "Descarga Elétrica", "classicos", "common", true, "free"),
    item("dragon-fire", AvatarDecoration, "Chamas de Dragão", "classicos", "common", true, "free"),
    item("frost-crown", AvatarDecoration, "Cristais de Gelo", "classicos", "common", true, "free"),
    item("heart-pixel", AvatarDecoration, "Corações Neon", "classicos", "common", true, "free"),
    item("neon-glitch", AvatarDecoration, "Anel Duplo Glitch", "classicos", "common", true, "free"),
    item("blood-moon", AvatarDecoration, "Lua Rubra", "classicos", "common", true, "free"),
    item("static-royal-crown", AvatarDecoration, "Coroa Imperial", "classicos", "common", false, "free"),
    item("static-gold", AvatarDecoration, "Louros Dourados", "classicos", "common", false, "free"),
    item("static-cyber-hud", AvatarDecoration, "Mira Tática", "classicos", "common", false, "free"),
    item("static-crimson", AvatarDecoration, "Rubi Gótico", "classicos", "common", false, "free"),
    item("static-diamond", AvatarDecoration, "Diamante Glacial", "classicos", "common", false, "free"),
    item("static-blurple", AvatarDecoration, "Brasão Sancord", "classicos", "common", false, "free"),
    item("static-emerald", AvatarDecoration, "Vinha Esmeralda", "classicos", "common", false, "free"),
    item("static-angel", AvatarDecoration, "Pérola Celestial", "classicos", "common", false, "free"),
    item("embers", ProfileEffect, "Brasas Carmesim", "classicos", "common", true, "free"),
    item("sparkles", ProfileEffect, "Poeira Estelar", "classicos", "common", true, "free"),
    item("sakura", ProfileEffect, "Chuva de Sakura", "classicos", "common", true, "free"),
    item("matrix", ProfileEffect, "Código Verde", "classicos", "common", true, "free"),
    item("lightning", ProfileEffect, "Tempestade Arcana", "classicos", "common", true, "free"),
    item("snow", ProfileEffect, "Neve Ártica", "classicos", "common", true, "free"),
    item("confetti", ProfileEffect, "Festa Confete", "classicos", "common", true, "free"),
    item("cyber", ProfileEffect, "Varredura Holográfica", "classicos", "common", true, "free"),
    item("hellfire", ProfileEffect, "Inferno Rubro", "classicos", "common", true, "free"),
    item("galaxy", ProfileEffect, "Nebulosa Rotativa", "classicos", "common", true, "free"),
    item("glitch", ProfileEffect, "Sinal VHS", "classicos", "common", true, "free"),
    item("aurora", ProfileEffect, "Aurora Boreal", "classicos", "common", true, "free"),
    item("crimson", Nameplate, "Carmesim Sombrio", "classicos", "common", false, "free"),
    item("nebula", Nameplate, "Nebulosa Roxa", "classicos", "common", false, "free"),
    item("aurora", Nameplate, "Aurora Ciano", "classicos", "common", false, "free"),
    item("sakura", Nameplate, "Sakura Suave", "classicos", "common", false, "free"),
    item("gold", Nameplate, "Ouro Real", "classicos", "common", false, "free"),
    item("cyber", Nameplate, "Grade Cyber", "classicos", "common", false, "free"),
    item("hellfire", Nameplate, "Chamas Rubras", "classicos", "common", false, "free"),
    item("frost", Nameplate, "Gelo Ártico", "classicos", "common", false, "free"),
    item("void", Nameplate, "Vazio Cósmico", "classicos", "common", false, "free"),
    item("toxic", Nameplate, "Tóxico Neon", "classicos", "common", false, "free"),
    item("synthwave", Nameplate, "Onda Retrô", "classicos", "common", false, "free"),
    item("gta", NameStyle, "Cursiva Vice", "classicos", "common", false, "free"),
    item("neon", NameStyle, "Neon Nítido", "classicos", "common", false, "free"),
    item("chrome", NameStyle, "Cromado", "classicos", "common", false, "free"),
    item("gradient", NameStyle, "Arco-íris Fluido", "classicos", "common", true, "free"),
    item("fire", NameStyle, "Chamas", "classicos", "common", false, "free"),
    item("ice", NameStyle, "Cristal Glacial", "classicos", "common", false, "free"),
    item("sakura", NameStyle, "Rosa Sakura", "classicos", "common", false, "free"),
    item("retro", NameStyle, "Pixel Retrô", "classicos", "common", false, "free"),
    item("gothic", NameStyle, "Gótico", "classicos", "common", false, "free"),
    item("toxic", NameStyle, "Ácido Neon", "classicos", "common", false, "free"),
    item("royal", NameStyle, "Ouro Imperial", "classicos", "common", false, "free"),
];

static CATALOG: OnceLock<Vec<CosmeticItem>> = OnceLock::new();

/// Catálogo completo. Itens novos entram em `extra_items()` (fases seguintes).
pub fn catalog() -> &'static [CosmeticItem] {
    CATALOG.get_or_init(|| {
        let mut all = CLASSIC.to_vec();
        all.extend(extra_items());
        all
    })
}

/// Fase 2 — coleções próprias do Sancord: decorações novas e molduras de perfil.
/// Arte em SVG/CSS no cliente (`static/js/profile.js` e `ui.css`), desenhada para o Sancord.
const PHASE2: &[CosmeticItem] = &[
    // Sancord Core (primeira coleção gratuita completa).
    item("core-orbit", AvatarDecoration, "Órbita", "sancord-core", "common", true, "free"),
    item("core-pulse", ProfileFrame, "Pulso Core", "sancord-core", "common", true, "free"),
    // Decorações novas.
    item("nebula-orbit", AvatarDecoration, "Órbita Nebular", "cosmic", "rare", true, "free"),
    item("sakura-fall", AvatarDecoration, "Pétalas ao Vento", "sakura", "rare", true, "free"),
    item("cyber-ring", AvatarDecoration, "Anel Cyber", "cyber", "rare", true, "free"),
    item("electric-pulse", AvatarDecoration, "Pulso Elétrico", "cyber", "rare", true, "free"),
    item("lunar", AvatarDecoration, "Lunar", "midnight", "rare", true, "free"),
    item("ember", AvatarDecoration, "Brasa", "inferno", "rare", true, "free"),
    item("snowfall", AvatarDecoration, "Nevada", "frost", "common", true, "free"),
    item("ocean-bubbles", AvatarDecoration, "Bolhas do Oceano", "ocean", "common", true, "free"),
    item("digital-rain", AvatarDecoration, "Chuva Digital", "cyber", "rare", true, "free"),
    item("retro-pixels", AvatarDecoration, "Pixels Retrô", "retro", "common", true, "free"),
    // Molduras estáticas.
    item("minimal", ProfileFrame, "Minimal", "sancord-core", "common", false, "free"),
    item("carbon", ProfileFrame, "Carbono", "midnight", "common", false, "free"),
    item("cyber-corners", ProfileFrame, "Cantos Cyber", "cyber", "common", false, "free"),
    item("sakura-corners", ProfileFrame, "Flores de Canto", "sakura", "common", false, "free"),
    item("royal", ProfileFrame, "Real", "royal", "rare", false, "free"),
    item("retro-pixel", ProfileFrame, "Pixel Retrô", "retro", "common", false, "free"),
    item("cosmic", ProfileFrame, "Cósmica", "cosmic", "rare", false, "free"),
    item("inferno", ProfileFrame, "Inferno", "inferno", "rare", false, "free"),
    item("frost", ProfileFrame, "Geada", "frost", "common", false, "free"),
    // Molduras animadas (movimento lento, sem piscar).
    item("neon-pulse", ProfileFrame, "Neon Pulsante", "cyber", "epic", true, "free"),
    item("prism-flow", ProfileFrame, "Fluxo Prisma", "sancord-core", "epic", true, "free"),
    item("electric", ProfileFrame, "Elétrica", "cyber", "epic", true, "free"),
    item("cosmic-drift", ProfileFrame, "Deriva Cósmica", "cosmic", "epic", true, "free"),
    item("sakura-wind", ProfileFrame, "Vento Sakura", "sakura", "epic", true, "free"),
    item("ember-trail", ProfileFrame, "Rastro de Brasa", "inferno", "epic", true, "free"),
    item("frost-glint", ProfileFrame, "Brilho de Geada", "frost", "epic", true, "free"),
    item("digital-glitch", ProfileFrame, "Glitch Digital", "cyber", "epic", true, "free"),
    item("liquid", ProfileFrame, "Líquida", "ocean", "epic", true, "free"),
    item("holographic", ProfileFrame, "Holográfica", "royal", "legendary", true, "free"),
    // Molduras reativas (exclusivas do Sancord): reagem a presença e voz, só cosmético.
    item("reactive-aura", ProfileFrame, "Aura Reativa", "sancord-core", "legendary", true, "free"),
    item("voice-pulse", ProfileFrame, "Pulso de Voz", "sancord-core", "legendary", true, "free"),
    // Por conquista: só com a badge, concedida pelo servidor.
    item("early-user", ProfileFrame, "Pioneira", "conquistas", "founder", false, "badge:early_user"),
    item("founder", ProfileFrame, "Fundação", "conquistas", "founder", true, "badge:founder"),
    item("developer", ProfileFrame, "Construção", "conquistas", "legendary", true, "badge:developer"),
    item("bug-hunter", ProfileFrame, "Caça-Bugs", "conquistas", "epic", false, "badge:bug_hunter"),
    item("community", ProfileFrame, "Comunidade", "conquistas", "epic", false, "badge:community"),
    item("event-champion", ProfileFrame, "Campeã de Evento", "conquistas", "event", true, "badge:event_winner"),
    // Temporada (preparada): só por inventário; quem recebe mantém.
    item("winter-2026", ProfileFrame, "Inverno 2026", "temporada-inverno", "event", true, "grant"),
];

/// Fase 3 — efeitos de entrada com arte própria em `static/ui.css`.
const PHASE3: &[CosmeticItem] = &[
    item("core-signal", ProfileEffect, "Sinal Core", "sancord-core", "common", true, "free"),
    item("star-trail", ProfileEffect, "Rastro Celeste", "cosmic", "rare", true, "free"),
    item("circuit-boot", ProfileEffect, "Circuito de Entrada", "cyber", "common", true, "free"),
    item("petal-drift", ProfileEffect, "Brisa de Pétalas", "sakura", "common", true, "free"),
    item("polar-ribbon", ProfileEffect, "Fita Polar", "frost", "rare", true, "free"),
    item("pixel-assembly", ProfileEffect, "Montagem de Pixels", "retro", "common", true, "free"),
    item("gravity-well", ProfileEffect, "Poço de Luz", "cosmic", "epic", true, "free"),
];

const PHASE4: &[CosmeticItem] = &[
    item("core-stripe", Nameplate, "Faixa Core", "sancord-core", "common", true, "free"),
    item("circuit-weave", Nameplate, "Trama de Circuitos", "cyber", "common", false, "free"),
    item("starlit-silt", Nameplate, "Sedimento Estelar", "cosmic", "rare", false, "free"),
    item("twilight-garden", Nameplate, "Jardim do Crepúsculo", "sakura", "common", false, "free"),
    item("gold-leaf", Nameplate, "Folha Dourada", "royal", "rare", false, "free"),
    item("retro-horizon", Nameplate, "Horizonte Retrô", "retro", "common", false, "free"),
    item("frost-vein", Nameplate, "Veio de Geada", "frost", "rare", false, "free"),
    item("ember-line", Nameplate, "Linha de Brasa", "inferno", "common", true, "free"),
    item("tide-glass", Nameplate, "Vidro de Maré", "ocean", "rare", true, "free"),
    item("modern", NameStyle, "Moderno", "sancord-core", "common", false, "free"),
    item("rounded", NameStyle, "Arredondado", "sancord-core", "common", false, "free"),
    item("mono", NameStyle, "Monoespaçado", "cyber", "common", false, "free"),
    item("outline", NameStyle, "Contorno", "sancord-core", "common", false, "free"),
    item("glow", NameStyle, "Brilho Suave", "cosmic", "common", true, "free"),
    item("prism", NameStyle, "Fluxo de Prisma", "cosmic", "rare", true, "free"),
    item("holographic", NameStyle, "Faixa Holográfica", "cyber", "rare", true, "free"),
    item("custom-gradient", NameStyle, "Gradiente Personalizado", "sancord-core", "common", true, "free"),
];

fn extra_items() -> Vec<CosmeticItem> {
    PHASE2.iter().chain(PHASE3).chain(PHASE4).cloned().collect()
}

/// Badges oficiais. "trust" = confirmação/confiança (sempre visíveis, nunca confundidas com
/// cosmético); "cosmetic" = lembranças. Só o servidor concede.
#[derive(Debug, Clone, Serialize)]
pub struct BadgeDef {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
}

pub const BADGES: &[BadgeDef] = &[
    BadgeDef { id: "founder", name: "Fundação", category: "trust", description: "Fundou o projeto Sancord." },
    BadgeDef { id: "developer", name: "Desenvolvimento", category: "trust", description: "Faz parte da equipe de desenvolvimento." },
    BadgeDef { id: "moderator", name: "Moderação oficial", category: "trust", description: "Modera a comunidade oficial." },
    BadgeDef { id: "verified_bot", name: "Bot verificado", category: "trust", description: "Integração verificada pelo Sancord." },
    BadgeDef { id: "verified_developer", name: "Dev verificado", category: "trust", description: "Desenvolvedor de integração verificado." },
    BadgeDef { id: "contributor", name: "Contribuição", category: "trust", description: "Contribuiu com código, tradução ou documentação." },
    BadgeDef { id: "bug_hunter", name: "Caça-Bugs", category: "trust", description: "Ajudou a encontrar problemas importantes." },
    BadgeDef { id: "event_winner", name: "Vencedora de evento", category: "trust", description: "Venceu um evento oficial." },
    BadgeDef { id: "early_user", name: "Pioneira", category: "cosmetic", description: "Conta criada na fase inicial do Sancord." },
    BadgeDef { id: "alpha", name: "Alpha", category: "cosmetic", description: "Participou do Alpha." },
    BadgeDef { id: "beta", name: "Beta", category: "cosmetic", description: "Participou do Beta." },
    BadgeDef { id: "community", name: "Comunidade", category: "cosmetic", description: "Reconhecimento da comunidade." },
    BadgeDef { id: "supporter", name: "Apoio inicial", category: "cosmetic", description: "Apoiou o Sancord no início." },
];

pub fn badge(id: &str) -> Option<&'static BadgeDef> {
    BADGES.iter().find(|b| b.id == id)
}

/// Contas criadas antes desta data ganham "early_user" automaticamente (fase inicial).
pub const EARLY_USER_CUTOFF: (i32, u32, u32) = (2027, 1, 1);

/// "18/11/2026" (formato salvo em `created_at`) → (ano, mês, dia).
fn parse_pt_date(s: &str) -> Option<(i32, u32, u32)> {
    let mut it = s.trim().split(|c: char| c == '/' || c.is_whitespace());
    let d: u32 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let y: i32 = it.next()?.parse().ok()?;
    Some((y, m, d))
}

/// Badges efetivas = concedidas pelo operador (arquivo `badges.json` na pasta de dados) +
/// automáticas. Ordenadas: confiança primeiro, depois cosméticas, na ordem de `BADGES`.
pub fn effective_badges(acc: &Account, granted: &[String]) -> Vec<String> {
    let mut set: Vec<String> = granted.iter().filter(|b| badge(b).is_some()).cloned().collect();
    // Sem data legível (contas muito antigas) também conta como fase inicial.
    let early = acc.created_at.as_deref().and_then(parse_pt_date).map_or(true, |(y, m, d)| (y, m, d) < EARLY_USER_CUTOFF);
    if early {
        set.push("early_user".into());
    }
    BADGES.iter().filter(|b| set.iter().any(|s| s == b.id)).map(|b| b.id.to_string()).collect()
}

/// Lê `badges.json` ({"usuario": ["founder", ...]}) da pasta de dados. Ausente ou inválido = vazio.
pub fn load_badge_grants(data_dir: &std::path::Path) -> std::collections::HashMap<String, Vec<String>> {
    std::fs::read_to_string(data_dir.join("badges.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<std::collections::HashMap<String, Vec<String>>>(&s).ok())
        .map(|m| m.into_iter().map(|(k, v)| (k.to_lowercase(), v)).collect())
        .unwrap_or_default()
}

/// Persiste `badges.json` de forma atômica (arquivo temporário + rename), omitindo contas sem selos manuais.
pub fn save_badge_grants(
    data_dir: &std::path::Path,
    grants: &std::collections::HashMap<String, Vec<String>>,
) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let cleaned: std::collections::BTreeMap<&String, &Vec<String>> = grants
        .iter()
        .filter(|(_, list)| !list.is_empty())
        .collect();
    let json = serde_json::to_string_pretty(&cleaned)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let target = data_dir.join("badges.json");
    let tmp = data_dir.join("badges.json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// Conta autorizada a gerenciar selos via painel administrativo:
/// possui badge `founder`/`developer` ou está listada em `SANCORD_OPERATORS`.
pub fn is_badge_operator(acc: &Account) -> bool {
    if acc
        .profile
        .badges
        .iter()
        .any(|b| matches!(b.as_str(), "founder" | "developer"))
    {
        return true;
    }
    if let Ok(raw) = std::env::var("SANCORD_OPERATORS") {
        let lower = acc.username.to_lowercase();
        return raw
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .any(|op| !op.is_empty() && op == lower);
    }
    false
}

pub fn find(kind: Kind, id: &str) -> Option<&'static CosmeticItem> {
    catalog().iter().find(|i| i.kind == kind && i.id == id)
}

pub fn owns(acc: &Account, item: &CosmeticItem) -> bool {
    match item.availability {
        "free" => true,
        a => {
            if let Some(badge) = a.strip_prefix("badge:") {
                if acc.profile.badges.iter().any(|b| b == badge) {
                    return true;
                }
            }
            acc.inventory.iter().any(|i| i == &inventory_key(item))
        }
    }
}

/// Chave no inventário: "tipo:id" (ids podem repetir entre tipos, ex.: "sakura").
pub fn inventory_key(item: &CosmeticItem) -> String {
    format!("{}:{}", kind_name(item.kind), item.id)
}

pub fn kind_name(kind: Kind) -> &'static str {
    match kind {
        AvatarDecoration => "avatar_decoration",
        ProfileFrame => "profile_frame",
        ProfileEffect => "profile_effect",
        Nameplate => "nameplate",
        NameStyle => "name_style",
    }
}

/// Valor pedido pelo cliente para equipar: `Ok(None)` = tirar; `Ok(Some(id))` = equipar.
/// "none", "default" e vazio tiram o item.
pub fn check_equip(acc: &Account, kind: Kind, requested: &str) -> Result<Option<String>, &'static str> {
    let id = requested.trim();
    if id.is_empty() || id == "none" || id == "default" {
        return Ok(None);
    }
    let item = find(kind, id).ok_or("Este item não existe no catálogo do Sancord.")?;
    if !owns(acc, item) {
        return Err("Você ainda não possui este item.");
    }
    Ok(Some(item.id.to_string()))
}

/// Chaves de inventário que a conta possui (gratuitos inclusos), para o cliente filtrar.
pub fn owned_keys(acc: &Account) -> Vec<String> {
    catalog().iter().filter(|i| owns(acc, i)).map(inventory_key).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_dates_and_order() {
        assert_eq!(parse_pt_date("18/11/2026"), Some((2026, 11, 18)));
        assert_eq!(parse_pt_date("x"), None);
        // Toda moldura de conquista aponta para uma badge que existe.
        for i in catalog() {
            if let Some(b) = i.availability.strip_prefix("badge:") {
                assert!(badge(b).is_some(), "badge inexistente: {b}");
            }
        }
        // Confiança antes de cosmética.
        let first_cosmetic = BADGES.iter().position(|b| b.category == "cosmetic").unwrap();
        assert!(BADGES[..first_cosmetic].iter().all(|b| b.category == "trust"));
    }

    #[test]
    fn catalog_ids_are_unique_per_kind_and_safe() {
        let mut seen = std::collections::HashSet::new();
        for i in catalog() {
            assert!(seen.insert((kind_name(i.kind), i.id)), "repetido: {}", i.id);
            assert!(i.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'), "id inseguro: {}", i.id);
            assert!(matches!(i.rarity, "common" | "rare" | "epic" | "legendary" | "event" | "founder"));
            assert!(i.availability == "free" || i.availability == "grant" || i.availability.starts_with("badge:"));
        }
    }
}
