//! Controle e sinalização reais; não substituem o ensaio de mídia no WebView2.
use super::*;

#[tokio::test]
async fn simultaneous_camera_screen_metadata_and_video_permission_revocation() {
    let srv = start_server().await;
    let (mut viewer, server, sid) = owner_with_server(&srv, "DonaVideo", "friends").await;
    let (mut publisher, _) = join_with(&srv, "VideoMembro", server["invite_code"].as_str().unwrap()).await;
    let channel = server["voice_channels"][0]["id"].as_str().unwrap();
    send(&mut viewer, json!({"type":"JoinVoice","payload":{"channel_id":channel}})).await;
    send(&mut publisher, json!({"type":"JoinVoice","payload":{"channel_id":channel}})).await;
    let (publisher_id, viewer_id) = loop {
        let sync = wait_for(&mut publisher, "VoiceStateSync").await;
        if sync["voice_members"][channel].as_array().is_some_and(|v| v.len() == 2) {
            let users = sync["users"].as_array().unwrap();
            let id = |name| users.iter().find(|u| u["username"] == name).unwrap()["id"].as_str().unwrap().to_owned();
            break (id("VideoMembro"), id("DonaVideo"));
        }
    };

    send(&mut publisher, json!({"type":"UpdateVoiceState","payload":{
        "muted":false,"deafened":false,"camera_on":true,"screen_sharing":true,
        "camera_stream_id":"camera-stream","screen_stream_id":"screen-stream","stream_quality":"1080p FHD"
    }})).await;
    loop {
        let sync = wait_for(&mut viewer, "VoiceStateSync").await;
        if let Some(u) = sync["users"].as_array().unwrap().iter().find(|u| u["id"] == publisher_id) {
            if u["camera_on"] == true && u["screen_sharing"] == true {
                assert_eq!(u["camera_stream_id"], "camera-stream");
                assert_eq!(u["screen_stream_id"], "screen-stream");
                assert_eq!(u["stream_quality"], "1080p FHD");
                break;
            }
        }
    }
    let sending = json!({"type":"offer","sdp":"v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n"});
    send(&mut publisher, json!({"type":"WebRtcOffer","payload":{"target_id":viewer_id,"sdp":sending}})).await;
    let offer = wait_for(&mut viewer, "WebRtcOffer").await;
    assert_eq!(offer["from_id"], publisher_id);
    assert_eq!(offer["sdp"], sending);

    // Revogar somente vídeo desconecta o publisher para interromper também o peer existente.
    send(&mut viewer, json!({"type":"UpdateChannelPermissions","payload":{
        "server_id":sid,"channel_id":channel,"overwrites":[
            {"target_type":"member","target_id":"videomembro","permissions":{"stream_video":false}}
        ]
    }})).await;
    let removed = wait_for(&mut publisher, "SelfUpdated").await;
    assert!(removed["user"]["voice_channel_id"].is_null());
    assert_eq!(removed["user"]["camera_on"], false);
    assert_eq!(removed["user"]["screen_sharing"], false);
    assert!(removed["user"]["camera_stream_id"].is_null());
    assert!(removed["user"]["screen_stream_id"].is_null());

    send(&mut publisher, json!({"type":"JoinVoice","payload":{"channel_id":channel}})).await;
    loop {
        let sync = wait_for(&mut publisher, "VoiceStateSync").await;
        if sync["voice_members"][channel].as_array().is_some_and(|v| v.contains(&json!(publisher_id))) { break; }
    }
    assert_eq!(srv.state.read().await.voice_media_permissions(&publisher_id), (true, false));
    send(&mut publisher, json!({"type":"UpdateVoiceState","payload":{
        "muted":false,"deafened":false,"camera_on":true,"screen_sharing":true
    }})).await;
    let feedback = wait_for(&mut publisher, "ServerFeedback").await;
    assert_eq!(feedback["action"], "voice_state");
    assert_eq!(feedback["ok"], false);

    // A oferta proibida não pode chegar antes da oferta recvonly válida, enviada em seguida.
    send(&mut publisher, json!({"type":"WebRtcOffer","payload":{"target_id":viewer_id,"sdp":sending}})).await;
    let receiving = json!({"type":"offer","sdp":"v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n"});
    send(&mut publisher, json!({"type":"WebRtcOffer","payload":{"target_id":viewer_id,"sdp":receiving}})).await;
    assert_eq!(wait_for(&mut viewer, "WebRtcOffer").await["sdp"], receiving);
}
