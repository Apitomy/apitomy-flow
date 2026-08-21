package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonFormat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public record WorkflowInstance(
    String id,
    String workflowId,
    String currentNodeId,
    InstanceStatus status,
    Map<String, Object> context,
    List<HistoryEntry> history,
    String failureReason,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant createdOn,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant updatedOn
) {
    public static Builder builder() {
        return new Builder();
    }

    public Builder toBuilder() {
        return new Builder()
            .id(id).workflowId(workflowId).currentNodeId(currentNodeId)
            .status(status).context(new HashMap<>(context))
            .history(new ArrayList<>(history)).failureReason(failureReason)
            .createdOn(createdOn).updatedOn(updatedOn);
    }

    public static class Builder {
        private String id;
        private String workflowId;
        private String currentNodeId;
        private InstanceStatus status;
        private Map<String, Object> context = new HashMap<>();
        private List<HistoryEntry> history = new ArrayList<>();
        private String failureReason;
        private Instant createdOn;
        private Instant updatedOn;

        public Builder id(String id) { this.id = id; return this; }
        public Builder workflowId(String workflowId) { this.workflowId = workflowId; return this; }
        public Builder currentNodeId(String currentNodeId) { this.currentNodeId = currentNodeId; return this; }
        public Builder status(InstanceStatus status) { this.status = status; return this; }
        public Builder context(Map<String, Object> context) { this.context = context; return this; }
        public Builder history(List<HistoryEntry> history) { this.history = history; return this; }
        public Builder failureReason(String failureReason) { this.failureReason = failureReason; return this; }
        public Builder createdOn(Instant createdOn) { this.createdOn = createdOn; return this; }
        public Builder updatedOn(Instant updatedOn) { this.updatedOn = updatedOn; return this; }

        public Builder addHistory(HistoryEntry entry) {
            this.history.add(entry);
            return this;
        }

        public Builder mergeContext(Map<String, Object> output) {
            if (output != null) this.context.putAll(output);
            return this;
        }

        public WorkflowInstance build() {
            return new WorkflowInstance(id, workflowId, currentNodeId, status,
                Map.copyOf(context), List.copyOf(history), failureReason, createdOn, updatedOn);
        }
    }
}
