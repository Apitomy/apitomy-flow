package io.apitomy.flow.validation;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum ValidationSeverity {
    @JsonProperty("error") ERROR,
    @JsonProperty("warning") WARNING
}
