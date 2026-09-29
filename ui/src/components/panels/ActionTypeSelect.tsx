import { useMemo, useRef, useState } from 'react';
import {
    Select, SelectOption, SelectList, MenuToggle, TextInputGroup,
    TextInputGroupMain, TextInputGroupUtilities, Button,
} from '@patternfly/react-core';
import { TimesIcon } from '@patternfly/react-icons';
import type { ActionTypeDescriptor } from '../../types/spi.ts';

/** Owns action-menu filtering, custom values, clear/open state and focus restoration. */
export function ActionTypeSelect({ value, actionTypes, loading, onSelect, onClear }: {
    value: string;
    actionTypes: ActionTypeDescriptor[];
    loading: boolean;
    onSelect: (value: string) => void;
    onClear: () => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [filterText, setFilterText] = useState('');
    const textInputRef = useRef<HTMLInputElement>(null);
    const displayValue = useMemo(() => {
        const match = actionTypes.find(action => action.value === value);
        return match ? match.label : value;
    }, [value, actionTypes]);
    const inputValue = isOpen ? filterText : displayValue;
    const filteredOptions = useMemo(() => {
        if (!filterText) return actionTypes;
        const lower = filterText.toLowerCase();
        return actionTypes.filter(action => action.label.toLowerCase().includes(lower)
            || action.value.toLowerCase().includes(lower));
    }, [filterText, actionTypes]);
    const isCustom = isOpen && filterText && !actionTypes.some(action => action.value === filterText
        || action.label.toLowerCase() === filterText.toLowerCase());

    const onInputChange = (_event: React.FormEvent<HTMLInputElement>, text: string) => {
        setFilterText(text);
        if (!isOpen) setIsOpen(true);
    };
    const onOptionSelect = (_event: React.MouseEvent | undefined, option: string | number | undefined) => {
        const selected = String(option);
        onSelect(selected.startsWith('__create__:') ? selected.slice('__create__:'.length) : selected);
        setFilterText('');
        setIsOpen(false);
        textInputRef.current?.focus();
    };
    const handleClear = () => {
        setFilterText('');
        onClear();
        textInputRef.current?.focus();
    };
    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        if (open) setFilterText('');
    };
    const toggle = (toggleRef: React.Ref<HTMLButtonElement>) => (
        <MenuToggle ref={toggleRef} variant="typeahead"
            onClick={() => { handleOpenChange(!isOpen); textInputRef.current?.focus(); }}
            isExpanded={isOpen} isDisabled={loading} isFullWidth>
            <TextInputGroup isPlain>
                <TextInputGroupMain value={inputValue} onClick={() => { if (!isOpen) setIsOpen(true); }}
                    onChange={onInputChange} innerRef={textInputRef}
                    placeholder={loading ? 'Loading...' : 'Select or type an action type'} autoComplete="off" />
                {(value || inputValue) && <TextInputGroupUtilities>
                    <Button variant="plain" onClick={handleClear} aria-label="Clear action type"><TimesIcon /></Button>
                </TextInputGroupUtilities>}
            </TextInputGroup>
        </MenuToggle>
    );
    return (
        <Select isOpen={isOpen} selected={value} onSelect={onOptionSelect} onOpenChange={handleOpenChange}
            toggle={toggle} shouldFocusFirstItemOnOpen={false}>
            <SelectList>
                {filteredOptions.map(action => (
                    <SelectOption key={action.value} value={action.value} description={action.description}>
                        {action.label}
                    </SelectOption>
                ))}
                {isCustom && <SelectOption value={`__create__:${inputValue}`}>
                    {`Use custom type "${inputValue}"`}
                </SelectOption>}
                {filteredOptions.length === 0 && !isCustom && <SelectOption isDisabled>No results found</SelectOption>}
            </SelectList>
        </Select>
    );
}
