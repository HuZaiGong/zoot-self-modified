export default {
    id: 'device-fabric',
    pages: ['settings-multi-device'],
    activate() {
        window.dispatchEvent(new CustomEvent('zoot:device-fabric-activate'));
    },
    deactivate() {
        window.dispatchEvent(new CustomEvent('zoot:device-fabric-suspend'));
    }
};
