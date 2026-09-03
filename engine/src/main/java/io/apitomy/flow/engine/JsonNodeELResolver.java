package io.apitomy.flow.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import jakarta.el.ELContext;
import jakarta.el.ELResolver;

/**
 * Jakarta EL resolver that enables property access on Jackson JsonNode objects,
 * allowing EL expressions like {@code context.payload.pull_request.author.login}
 * to navigate a parsed JSON tree.
 */
public class JsonNodeELResolver extends ELResolver {

    @Override
    public Object getValue(ELContext context, Object base, Object property) {
        if (base instanceof JsonNode node && property != null) {
            context.setPropertyResolved(true);
            if (node instanceof ArrayNode && property instanceof Number index) {
                JsonNode element = node.get(index.intValue());
                return unwrap(element);
            }
            JsonNode child = node.get(property.toString());
            return unwrap(child);
        }
        return null;
    }

    @Override
    public Class<?> getType(ELContext context, Object base, Object property) {
        if (base instanceof JsonNode node && property != null) {
            context.setPropertyResolved(true);
            JsonNode child = node.get(property.toString());
            if (child == null || child.isNull()) return null;
            if (child.isTextual()) return String.class;
            if (child.isInt() || child.isLong()) return Long.class;
            if (child.isDouble() || child.isFloat()) return Double.class;
            if (child.isBoolean()) return Boolean.class;
            return JsonNode.class;
        }
        return null;
    }

    @Override
    public void setValue(ELContext context, Object base, Object property, Object value) {
    }

    @Override
    public boolean isReadOnly(ELContext context, Object base, Object property) {
        if (base instanceof JsonNode) {
            context.setPropertyResolved(true);
            return true;
        }
        return false;
    }

    @Override
    public Class<?> getCommonPropertyType(ELContext context, Object base) {
        if (base instanceof JsonNode) return String.class;
        return null;
    }

    private Object unwrap(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (node.isTextual()) return node.asText();
        if (node.isInt()) return node.asInt();
        if (node.isLong()) return node.asLong();
        if (node.isDouble() || node.isFloat()) return node.asDouble();
        if (node.isBoolean()) return node.asBoolean();
        return node;
    }
}
