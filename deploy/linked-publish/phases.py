"""Single-owner phase semantics, isolated for exhaustive failure-path tests."""
class StageUncertain(RuntimeError): pass
def execute_phases(ops, rolled_back_type, outcome, uncertain_type=StageUncertain):
    # hold failure is never guessed to have restored itself.
    outcome['hold']=ops.hold()
    restore=False
    pin=None
    pin_attempted=False
    installed=False
    try:
        # prepare/schema failure is known-recoverable only if the runner proves
        # its transient child stopped. Uncertain execution retains the hold.
        restore=True
        outcome['schema']=ops.stage('schema')
        pin_attempted=True
        outcome['pin']=ops.stage('pin')
        pin=outcome['pin']['pinned']['run_id']
        outcome['prebuild']=ops.prebuild()
        restore=False
        try:
            outcome['overlay']=ops.install()
            installed=True
        except rolled_back_type:
            # The historical controller independently verified old-byte rollback.
            restore=True
            raise
        restore=True
        return outcome
    except uncertain_type:
        restore=False
        outcome['restoreDeferred']='Staged child is not verified stopped'
        raise
    finally:
        if restore and pin_attempted and not installed:
            # Never unpin following unknown overlay state or without proving the
            # exact old runtime. On failure here preserve the hold for recovery.
            restore=False
            ops.baseline()
            outcome['pinRecovery']=ops.stage('unpin',pin)
            restore=True
        if restore:
            outcome['searchRestore']=ops.restore()
        else:
            outcome.setdefault('restoreDeferred','Runtime outcome unverified; preserve hold and pin')
