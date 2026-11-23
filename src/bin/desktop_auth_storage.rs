use ::windows::core::PCWSTR;
use ::windows::Win32::Foundation::{LocalFree, HLOCAL};
use ::windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const MAX_VALUE_BYTES: usize = 64 * 1024;
pub const MAX_IPC_BYTES: usize = 3 * MAX_VALUE_BYTES;

#[derive(serde::Deserialize)]
struct Request {
    id: String,
    action: String,
    scope: String,
    value: String,
}

pub fn handle_request(message: &str) -> Option<serde_json::Value> {
    let request: Request = serde_json::from_str(message).ok()?;
    if request.id.len() != 32 || !request.id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let value = if request.scope.len() <= 512 {
        let primary_binding = sancord::legacy_sancord_migration::dpapi_entropy_for_scope(&request.scope);
        let legacy_binding = sancord::legacy_sancord_migration::dpapi_legacy_entropy_for_scope(&request.scope);
        match request.action.as_str() {
            "seal" if request.value.len() <= MAX_VALUE_BYTES => {
                transform(request.value.into_bytes(), primary_binding.into_bytes(), true).map(hex::encode)
            }
            "open" if request.value.len() <= 2 * (MAX_VALUE_BYTES + 1024) => hex::decode(request.value)
                .ok()
                .and_then(|input| {
                    // Tenta entropia oficial do Sanvo primeiro; fallback transparente para sessões legadas do Sancord.
                    transform(input.clone(), primary_binding.into_bytes(), false)
                        .or_else(|| transform(input, legacy_binding.into_bytes(), false))
                })
                .and_then(|plain| String::from_utf8(plain).ok()),
            _ => None,
        }
    } else {
        None
    };
    Some(serde_json::json!({ "id": request.id, "value": value }))
}

fn transform(mut value: Vec<u8>, mut binding: Vec<u8>, seal: bool) -> Option<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_mut_ptr(),
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: binding.len() as u32,
        pbData: binding.as_mut_ptr(),
    };
    let mut result = CRYPT_INTEGER_BLOB::default();
    // DPAPI usa a conta Windows atual. Os buffers de entrada continuam válidos
    // durante a chamada e a saída alocada pela API é sempre liberada com LocalFree.
    let status = unsafe {
        if seal {
            CryptProtectData(&input, PCWSTR::null(), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut result)
        } else {
            CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut result)
        }
    };
    if result.pbData.is_null() {
        return None;
    }
    unsafe {
        let output = status.ok().map(|_| {
            std::slice::from_raw_parts(result.pbData, result.cbData as usize).to_vec()
        });
        let _ = LocalFree(HLOCAL(result.pbData.cast()));
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ciphertext_is_bound_to_the_authentication_scope() {
        let payload = b"example QA session".to_vec();
        let scope = b"persistente:https://test.invalid".to_vec();
        let sealed = transform(payload.clone(), scope.clone(), true).expect("DPAPI seal");
        assert_ne!(sealed, payload);
        assert_eq!(transform(sealed.clone(), scope, false), Some(payload));
        assert!(transform(sealed, b"temporaria:https://other.invalid".to_vec(), false).is_none());
    }

    #[test]
    fn legacy_sancord_ciphertext_opens_cleanly_in_sanvo() {
        let scope = "persistente:sancord_token:http://127.0.0.1:3000";
        let legacy_entropy = sancord::legacy_sancord_migration::dpapi_legacy_entropy_for_scope(scope);
        let sealed_legacy = hex::encode(
            transform(b"tok-legado-sancord".to_vec(), legacy_entropy.into_bytes(), true)
                .expect("DPAPI legacy seal"),
        );

        let open_req = serde_json::json!({
            "id": "0123456789abcdef0123456789abcdef",
            "action": "open",
            "scope": scope,
            "value": sealed_legacy,
        })
        .to_string();
        let resp = handle_request(&open_req).expect("handle_request open legacy");
        assert_eq!(resp["value"].as_str(), Some("tok-legado-sancord"));

        // Novos seals usam entropia Sanvo e também abrem normalmente.
        let seal_req = serde_json::json!({
            "id": "fedcba9876543210fedcba9876543210",
            "action": "seal",
            "scope": scope,
            "value": "tok-novo-sanvo",
        })
        .to_string();
        let sealed_sanvo = handle_request(&seal_req).unwrap()["value"]
            .as_str()
            .unwrap()
            .to_string();
        let open_sanvo_req = serde_json::json!({
            "id": "fedcba9876543210fedcba9876543210",
            "action": "open",
            "scope": scope,
            "value": sealed_sanvo,
        })
        .to_string();
        let resp_sanvo = handle_request(&open_sanvo_req).expect("handle_request open sanvo");
        assert_eq!(resp_sanvo["value"].as_str(), Some("tok-novo-sanvo"));
    }
}
