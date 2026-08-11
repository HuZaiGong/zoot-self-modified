// 构建 PC 端私聊请求体
window.buildProxyChatRequest = function(operatorId, userMessage, isScenario, operatorScenario, history, identity = {}) {
    return {
        operator_id: operatorId,
        user_message: userMessage,
        is_scenario: isScenario,
        operator_scenario: operatorScenario,
        history: history || [],
        user_message_id: identity.user_message_id || null,
        message_uid: identity.message_uid || null,
        client_request_id: identity.client_request_id || identity.message_uid || null,
        persona_id: identity.persona_id || 'doctor',
        origin_device_id: identity.origin_device_id || null
    };
};

// 构建 PC 端群聊请求体
window.buildProxyGroupChatRequest = function(groupId, userMessage, isScenario, operatorScenario, history, identity = {}) {
    return {
        group_id: groupId,
        user_message: userMessage,
        is_scenario: isScenario,
        operator_scenario: operatorScenario,
        history: history || [],
        user_message_id: identity.user_message_id || null,
        message_uid: identity.message_uid || null,
        client_request_id: identity.client_request_id || identity.message_uid || null,
        persona_id: identity.persona_id || 'doctor',
        origin_device_id: identity.origin_device_id || null
    };
};

// 规范化私聊响应格式
window.normalizeProxyResponse = function(response) {
    return {
        operator_id: response.operator_id,
        reply: response.reply,
        timestamp: response.timestamp,
        new_trust: response.new_trust,
        is_scenario: response.is_scenario,
        operator_is_scenario: response.operator_is_scenario,
        message_contents: response.message_contents,
        message_types: response.message_types,
        message_id: response.message_id,
        message_ids: response.message_ids,
        message_uids: response.message_uids,
        user_message_id: response.user_message_id,
        user_message_uid: response.user_message_uid,
        conversation_key: response.conversation_key
    };
};

// 规范化群聊响应格式
window.normalizeProxyGroupResponse = function(response) {
    return {
        group_id: response.group_id,
        reply: response.reply,
        timestamp: response.timestamp,
        new_trust: response.new_trust,
        is_scenario: response.is_scenario,
        operator_is_scenario: response.operator_is_scenario,
        message_contents: response.message_contents,
        message_types: response.message_types,
        message_id: response.message_id,
        message_ids: response.message_ids,
        message_uids: response.message_uids,
        user_message_id: response.user_message_id,
        user_message_uid: response.user_message_uid,
        conversation_key: response.conversation_key
    };
};
