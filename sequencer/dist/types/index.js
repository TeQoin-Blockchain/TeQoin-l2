"use strict";
// ═══════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCode = exports.SequencerError = exports.ServiceState = void 0;
var ServiceState;
(function (ServiceState) {
    ServiceState["STOPPED"] = "stopped";
    ServiceState["STARTING"] = "starting";
    ServiceState["RUNNING"] = "running";
    ServiceState["ERROR"] = "error";
    ServiceState["STOPPING"] = "stopping";
})(ServiceState || (exports.ServiceState = ServiceState = {}));
// ───────────────────────────────────────────────────────
// ERROR TYPES
// ───────────────────────────────────────────────────────
class SequencerError extends Error {
    code;
    details;
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'SequencerError';
    }
}
exports.SequencerError = SequencerError;
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["CONFIG_ERROR"] = "CONFIG_ERROR";
    ErrorCode["DATABASE_ERROR"] = "DATABASE_ERROR";
    ErrorCode["RPC_ERROR"] = "RPC_ERROR";
    ErrorCode["CONTRACT_ERROR"] = "CONTRACT_ERROR";
    ErrorCode["PROCESSING_ERROR"] = "PROCESSING_ERROR";
    ErrorCode["BATCH_ERROR"] = "BATCH_ERROR";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
//# sourceMappingURL=index.js.map