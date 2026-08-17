package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum InstanceStatus {
    @JsonProperty("running") RUNNING,
    @JsonProperty("waiting") WAITING,
    @JsonProperty("completed") COMPLETED,
    @JsonProperty("failed") FAILED,
    @JsonProperty("cancelled") CANCELLED
}
