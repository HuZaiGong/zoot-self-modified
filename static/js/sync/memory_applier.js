// 将 PC 端记忆变更应用到移动端本地数据库（通过 Android 接口）
function applyMemoryChanges(unit, changes) {
    if (!window.Android || typeof window.Android.applyMemoryChanges !== 'function') {
        console.error('Android.applyMemoryChanges 未实现');
        return false;
    }
    const payload = JSON.stringify({ unit, changes });
    return window.Android.applyMemoryChanges(payload);
}

window.applyMemoryChanges = async function(unit, changes) {
    try {
        const response = await fetch('/sync/apply_changes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unit, changes })
        });
        if (!response.ok) {
            console.error('applyMemoryChanges failed', response.status);
            return false;
        }
        const result = await response.json();
        return result.success === true;
    } catch (e) {
        console.error('applyMemoryChanges error', e);
        return false;
    }
};