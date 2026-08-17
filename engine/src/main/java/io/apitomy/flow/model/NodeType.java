package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum NodeType {
    @JsonProperty("start") START,
    @JsonProperty("end") END,
    @JsonProperty("action") ACTION,
    @JsonProperty("human-task") HUMAN_TASK,
    @JsonProperty("receive-event") RECEIVE_EVENT
}
