/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import React, { useState } from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import {
  useDialogDismiss,
  getActiveModalStackDepth,
  clearActiveModalStack,
  getFocusableElements
} from '../src/renderer/hooks/useDialogDismiss'

describe('Ticket 06: Unified Modal Dialog Dismiss & Focus Trap Mechanics', () => {
  beforeEach(() => {
    clearActiveModalStack()
    document.body.innerHTML = ''
    vi.useFakeTimers()
  })

  afterEach(() => {
    clearActiveModalStack()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('handles Escape key capture phase dismissal correctly', () => {
    const onClose = vi.fn()

    function TestModal({ isOpen = true, disableEscape = false }: { isOpen?: boolean; disableEscape?: boolean }) {
      const { dialogRef } = useDialogDismiss({ onClose, isOpen, disableEscape })
      return React.createElement(
        'div',
        { ref: dialogRef, role: 'dialog' },
        React.createElement('button', { type: 'button' }, 'Inside Button')
      )
    }

    const { unmount, rerender } = render(React.createElement(TestModal, { isOpen: true }))

    // 1. Esc key when modal is open and closeOnEscape is enabled -> calls onClose
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    // 2. Non-Escape key (e.g. Enter) does not close
    onClose.mockClear()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()

    // 3. Escape key when disableEscape is true
    rerender(React.createElement(TestModal, { isOpen: true, disableEscape: true }))
    onClose.mockClear()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    // 4. Escape key when modal is closed (isOpen = false)
    rerender(React.createElement(TestModal, { isOpen: false }))
    onClose.mockClear()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    unmount()
  })

  it('manages nested dialog LIFO modal stack: top-most modal consumes Escape first', () => {
    const onParentClose = vi.fn()
    const onChildClose = vi.fn()

    function NestedModals({ showChild }: { showChild: boolean }) {
      const parentDismiss = useDialogDismiss({ onClose: onParentClose, isOpen: true })
      const childDismiss = useDialogDismiss({ onClose: onChildClose, isOpen: showChild })

      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { ref: parentDismiss.dialogRef, role: 'dialog', 'aria-label': 'parent-dialog' },
          React.createElement('span', null, 'Parent Dialog'),
          showChild
            ? React.createElement(
                'div',
                { ref: childDismiss.dialogRef, role: 'dialog', 'aria-label': 'child-dialog' },
                React.createElement('span', null, 'Child Dialog')
              )
            : null
        )
      )
    }

    // Mount parent only
    const { rerender, unmount } = render(React.createElement(NestedModals, { showChild: false }))
    expect(getActiveModalStackDepth()).toBe(1)

    // Open child modal -> stack depth is 2
    rerender(React.createElement(NestedModals, { showChild: true }))
    expect(getActiveModalStackDepth()).toBe(2)

    // First Escape: must only close the child dialog (top of stack)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onChildClose).toHaveBeenCalledTimes(1)
    expect(onParentClose).not.toHaveBeenCalled()

    // Simulate child closing (rerender without child)
    rerender(React.createElement(NestedModals, { showChild: false }))
    expect(getActiveModalStackDepth()).toBe(1)

    // Second Escape: now parent is on top of stack, so it consumes Escape
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onParentClose).toHaveBeenCalledTimes(1)

    unmount()
    expect(getActiveModalStackDepth()).toBe(0)
  })

  it('prevents accidental backdrop dismiss when mouse drag originates inside dialog', () => {
    const onClose = vi.fn()

    function BackdropModal({ disableBackdropClick = false }: { disableBackdropClick?: boolean }) {
      const { dialogRef, backdropProps } = useDialogDismiss({ onClose, disableBackdropClick })
      return React.createElement(
        'div',
        { 'data-testid': 'backdrop', ...backdropProps },
        React.createElement(
          'div',
          { ref: dialogRef, 'data-testid': 'content' },
          React.createElement('span', null, 'Modal Text Content')
        )
      )
    }

    const { getByTestId, rerender } = render(React.createElement(BackdropModal))
    const backdrop = getByTestId('backdrop')
    const content = getByTestId('content')

    // Scenario A: User clicks purely on backdrop (mouse down on backdrop, mouse up / click on backdrop)
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Scenario B: User selects text inside dialog, drags mouse outside, and releases mouse on backdrop
    onClose.mockClear()
    fireEvent.mouseDown(content)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()

    // Scenario C: disableBackdropClick is true
    rerender(React.createElement(BackdropModal, { disableBackdropClick: true }))
    onClose.mockClear()
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('traps Tab and Shift+Tab focus navigation in cyclic loop and retains focus', () => {
    function TrapModal() {
      const { dialogRef } = useDialogDismiss({ trapFocus: true })
      return React.createElement(
        'div',
        { ref: dialogRef, role: 'dialog' },
        React.createElement('button', { 'data-testid': 'btn-first', type: 'button' }, 'First'),
        React.createElement('input', { 'data-testid': 'input-mid', type: 'text' }),
        React.createElement('button', { 'data-testid': 'btn-last', type: 'button' }, 'Last')
      )
    }

    const { getByTestId } = render(React.createElement(TrapModal))
    const btnFirst = getByTestId('btn-first')
    const btnLast = getByTestId('btn-last')

    // Advance timer to trigger auto initial focus
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(document.activeElement).toBe(btnFirst)

    // 1. Tab on last element -> wraps to first element
    btnLast.focus()
    expect(document.activeElement).toBe(btnLast)
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, cancelable: true, bubbles: true })
    const preventSpy = vi.spyOn(tabEvent, 'preventDefault')
    btnLast.dispatchEvent(tabEvent)
    expect(preventSpy).toHaveBeenCalled()
    expect(document.activeElement).toBe(btnFirst)

    // 2. Shift+Tab on first element -> wraps to last element
    btnFirst.focus()
    expect(document.activeElement).toBe(btnFirst)
    const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true, bubbles: true })
    const shiftPreventSpy = vi.spyOn(shiftTabEvent, 'preventDefault')
    btnFirst.dispatchEvent(shiftTabEvent)
    expect(shiftPreventSpy).toHaveBeenCalled()
    expect(document.activeElement).toBe(btnLast)

    // 3. Focus retention: if focus moves outside dialog, focusin pulls it back inside
    const outsideBtn = document.createElement('button')
    document.body.appendChild(outsideBtn)
    outsideBtn.focus()
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(document.activeElement).toBe(btnFirst)
    document.body.removeChild(outsideBtn)
  })

  it('restores focus to original trigger element upon dialog close', () => {
    const triggerBtn = document.createElement('button')
    triggerBtn.setAttribute('id', 'page-trigger-btn')
    triggerBtn.textContent = 'Open Dialog'
    document.body.appendChild(triggerBtn)
    triggerBtn.focus()
    expect(document.activeElement).toBe(triggerBtn)

    function DialogApp() {
      const [open, setOpen] = useState(true)
      const { dialogRef } = useDialogDismiss({
        isOpen: open,
        onClose: () => setOpen(false)
      })

      if (!open) return null
      return React.createElement(
        'div',
        { ref: dialogRef, role: 'dialog' },
        React.createElement('button', { 'data-testid': 'dialog-btn', type: 'button' }, 'Inside')
      )
    }

    const { getByTestId, unmount } = render(React.createElement(DialogApp))
    const dialogBtn = getByTestId('dialog-btn')
    dialogBtn.focus()
    expect(document.activeElement).toBe(dialogBtn)

    // Unmount dialog -> focus is genuinely restored to triggerBtn!
    unmount()
    expect(document.activeElement).toBe(triggerBtn)

    document.body.removeChild(triggerBtn)
  })

  it('restores focus in multi-level nested modals hierarchically (LIFO focus restoration)', () => {
    const pageBtn = document.createElement('button')
    pageBtn.setAttribute('id', 'page-btn')
    document.body.appendChild(pageBtn)
    pageBtn.focus()
    expect(document.activeElement).toBe(pageBtn)

    function NestedDialogApp({ showChild }: { showChild: boolean }) {
      const parentDismiss = useDialogDismiss({ isOpen: true })
      const childDismiss = useDialogDismiss({ isOpen: showChild })

      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { ref: parentDismiss.dialogRef, role: 'dialog', 'aria-label': 'parent' },
          React.createElement('button', { 'data-testid': 'parent-open-child-btn', type: 'button' }, 'Open Child'),
          showChild
            ? React.createElement(
                'div',
                { ref: childDismiss.dialogRef, role: 'dialog', 'aria-label': 'child' },
                React.createElement('button', { 'data-testid': 'child-action-btn', type: 'button' }, 'Confirm Child')
              )
            : null
        )
      )
    }

    // Step 1: Parent opens, user focuses parent button
    const { getByTestId, rerender, unmount } = render(React.createElement(NestedDialogApp, { showChild: false }))
    const parentBtn = getByTestId('parent-open-child-btn')
    parentBtn.focus()
    expect(document.activeElement).toBe(parentBtn)

    // Step 2: Child opens (triggered from parentBtn)
    rerender(React.createElement(NestedDialogApp, { showChild: true }))
    const childBtn = getByTestId('child-action-btn')
    childBtn.focus()
    expect(document.activeElement).toBe(childBtn)

    // Step 3: Child closes -> focus is restored to parentBtn!
    rerender(React.createElement(NestedDialogApp, { showChild: false }))
    expect(document.activeElement).toBe(parentBtn)

    // Step 4: Parent closes -> focus is restored to pageBtn!
    unmount()
    expect(document.activeElement).toBe(pageBtn)

    document.body.removeChild(pageBtn)
  })

  it('protects parent dialog from Escape when top modal has disableEscape: true', () => {
    const onParentClose = vi.fn()
    const onChildClose = vi.fn()

    function ProtectedNestedApp() {
      const parent = useDialogDismiss({ onClose: onParentClose, isOpen: true })
      const child = useDialogDismiss({ onClose: onChildClose, isOpen: true, disableEscape: true })

      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { ref: parent.dialogRef, role: 'dialog' },
          React.createElement(
            'div',
            { ref: child.dialogRef, role: 'dialog' },
            React.createElement('button', { type: 'button' }, 'Locked Child')
          )
        )
      )
    }

    const { unmount } = render(React.createElement(ProtectedNestedApp))
    expect(getActiveModalStackDepth()).toBe(2)

    // Pressing Escape should NOT close child (disableEscape: true) AND must NOT close parent!
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onChildClose).not.toHaveBeenCalled()
    expect(onParentClose).not.toHaveBeenCalled()

    unmount()
    expect(getActiveModalStackDepth()).toBe(0)
  })

  it('ignores Escape key during IME composition (isComposing or keyCode 229)', () => {
    const onClose = vi.fn()

    function TestModal() {
      const { dialogRef } = useDialogDismiss({ onClose, isOpen: true })
      return React.createElement(
        'div',
        { ref: dialogRef, role: 'dialog' },
        React.createElement('input', { 'data-testid': 'text-input', type: 'text' })
      )
    }

    const { getByTestId, unmount } = render(React.createElement(TestModal))
    const input = getByTestId('text-input')
    input.focus()

    // 1. Escape with isComposing = true (e.g. canceling Chinese Pinyin candidates) -> must NOT close
    const composingEscEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
    Object.defineProperty(composingEscEvent, 'isComposing', { value: true })
    window.dispatchEvent(composingEscEvent)
    expect(onClose).not.toHaveBeenCalled()
    expect(composingEscEvent.defaultPrevented).toBe(false)

    // 2. Escape with keyCode = 229 (IME processing key event) -> must NOT close
    const ime229Event = new KeyboardEvent('keydown', {
      key: 'Escape',
      keyCode: 229,
      bubbles: true,
      cancelable: true
    } as KeyboardEventInit)
    window.dispatchEvent(ime229Event)
    expect(onClose).not.toHaveBeenCalled()

    // 3. Regular Escape (after composition ended) -> closes modal
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('prevents parent auto-focus timer from stealing focus when child modal opens rapidly', () => {
    function NestedApp({ showChild }: { showChild: boolean }) {
      const parentDismiss = useDialogDismiss({ isOpen: true, trapFocus: true })
      const childDismiss = useDialogDismiss({ isOpen: showChild, trapFocus: true })

      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { ref: parentDismiss.dialogRef, role: 'dialog', 'aria-label': 'parent' },
          React.createElement('button', { 'data-testid': 'parent-btn', type: 'button' }, 'Parent Button')
        ),
        showChild
          ? React.createElement(
              'div',
              { ref: childDismiss.dialogRef, role: 'dialog', 'aria-label': 'child' },
              React.createElement('button', { 'data-testid': 'child-btn', type: 'button' }, 'Child Button')
            )
          : null
      )
    }

    const { getByTestId, rerender, unmount } = render(React.createElement(NestedApp, { showChild: false }))

    // Parent is mounted, 40ms timer scheduled. Advance 20ms.
    act(() => {
      vi.advanceTimersByTime(20)
    })

    // Rapidly open child dialog at t = 20ms
    rerender(React.createElement(NestedApp, { showChild: true }))
    const childBtn = getByTestId('child-btn')
    childBtn.focus()
    expect(document.activeElement).toBe(childBtn)

    // Now advance past 40ms so parent timer fires (e.g. t = 50ms)
    act(() => {
      vi.advanceTimersByTime(30)
    })

    // Child button MUST still be focused! Parent timer must not steal focus!
    expect(document.activeElement).toBe(childBtn)

    unmount()
  })

  it('isolates Tab trapping in nested dialogs without parent event bubbling interference', () => {
    function NestedHierarchy() {
      const parentDismiss = useDialogDismiss({ isOpen: true, trapFocus: true })
      const childDismiss = useDialogDismiss({ isOpen: true, trapFocus: true })

      return React.createElement(
        'div',
        { ref: parentDismiss.dialogRef, role: 'dialog', 'aria-label': 'parent' },
        React.createElement('button', { 'data-testid': 'parent-btn', type: 'button' }, 'Parent Btn'),
        React.createElement(
          'div',
          { ref: childDismiss.dialogRef, role: 'dialog', 'aria-label': 'child' },
          React.createElement('button', { 'data-testid': 'child-btn-1', type: 'button' }, 'Child Btn 1'),
          React.createElement('button', { 'data-testid': 'child-btn-2', type: 'button' }, 'Child Btn 2')
        )
      )
    }

    const { getByTestId, unmount } = render(React.createElement(NestedHierarchy))
    const parentBtn = getByTestId('parent-btn')
    const childBtn1 = getByTestId('child-btn-1')
    const childBtn2 = getByTestId('child-btn-2')

    // Focus child btn 2 (last element of child dialog)
    childBtn2.focus()
    expect(document.activeElement).toBe(childBtn2)

    // Press Tab on child btn 2 -> wraps to child btn 1, MUST NOT jump to parentBtn!
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, cancelable: true, bubbles: true })
    childBtn2.dispatchEvent(tabEvent)

    expect(document.activeElement).toBe(childBtn1)
    expect(document.activeElement).not.toBe(parentBtn)

    unmount()
  })

  it('restores focus correctly even when modal contains autoFocus elements', () => {
    const triggerBtn = document.createElement('button')
    triggerBtn.setAttribute('id', 'page-autofocus-trigger')
    triggerBtn.textContent = 'Open AutoFocus Modal'
    document.body.appendChild(triggerBtn)
    triggerBtn.focus()
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(document.activeElement).toBe(triggerBtn)

    function AutoFocusModal() {
      const { dialogRef } = useDialogDismiss({ isOpen: true, restoreFocus: true })
      return React.createElement(
        'div',
        { ref: dialogRef, role: 'dialog' },
        React.createElement('input', { 'data-testid': 'auto-input', autoFocus: true })
      )
    }

    const { getByTestId, unmount } = render(React.createElement(AutoFocusModal))
    const autoInput = getByTestId('auto-input')
    autoInput.focus()
    expect(document.activeElement).toBe(autoInput)

    // Unmount modal -> focus is restored to page trigger!
    unmount()
    expect(document.activeElement).toBe(triggerBtn)

    document.body.removeChild(triggerBtn)
  })

  it('gracefully handles trigger element removal without throwing', () => {
    const triggerBtn = document.createElement('button')
    document.body.appendChild(triggerBtn)
    triggerBtn.focus()

    function RemovableTriggerModal() {
      const { dialogRef } = useDialogDismiss({ isOpen: true, restoreFocus: true })
      return React.createElement(
        'div',
        { ref: dialogRef, role: 'dialog' },
        React.createElement('button', { type: 'button' }, 'Inside')
      )
    }

    const { unmount } = render(React.createElement(RemovableTriggerModal))

    // Remove triggerBtn from DOM while modal is open (e.g. item deleted)
    document.body.removeChild(triggerBtn)

    // Closing/unmounting must not throw error
    expect(() => unmount()).not.toThrow()
  })

  it('excludes disabled elements, hidden inputs, aria-hidden containers, and nested dialogs from focusable list', () => {
    const container = document.createElement('div')
    container.setAttribute('role', 'dialog')
    container.innerHTML = `
      <button id="btn-valid">Valid</button>
      <input type="hidden" id="input-hidden" value="123" />
      <button id="btn-disabled" disabled>Disabled</button>
      <div aria-hidden="true">
        <button id="btn-aria-hidden">Aria Hidden</button>
      </div>
      <div role="dialog" id="nested-dialog">
        <button id="btn-nested">Nested Dialog Button</button>
      </div>
    `
    document.body.appendChild(container)

    const focusables = getFocusableElements(container)
    const ids = focusables.map((el) => el.id)

    expect(ids).toEqual(['btn-valid'])
    expect(ids).not.toContain('input-hidden')
    expect(ids).not.toContain('btn-disabled')
    expect(ids).not.toContain('btn-aria-hidden')
    expect(ids).not.toContain('btn-nested')

    document.body.removeChild(container)
  })
})
