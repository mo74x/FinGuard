import { Injectable } from '@nestjs/common';
import { CaseStatus } from '../../generated/prisma/enums';
import { InvalidStateTransitionException } from './exceptions/invalid-state-transition.exception';

@Injectable()
export class VerificationStateMachineService {
  /**
   * The single source of truth for legal transitions.
   * Maps a state to a Set of legally permitted next states.
   */
  private readonly transitionGraph: Record<CaseStatus, Set<CaseStatus>> = {
    [CaseStatus.DRAFT]: new Set([CaseStatus.SUBMITTED]),
    [CaseStatus.SUBMITTED]: new Set([CaseStatus.UNDER_REVIEW]),
    [CaseStatus.UNDER_REVIEW]: new Set([
      CaseStatus.VERIFIED,
      CaseStatus.REJECTED,
      CaseStatus.ADDITIONAL_INFO_REQUIRED,
    ]),
    [CaseStatus.ADDITIONAL_INFO_REQUIRED]: new Set([CaseStatus.SUBMITTED]),
    [CaseStatus.VERIFIED]: new Set(), // Terminal state
    [CaseStatus.REJECTED]: new Set(), // Terminal state
  };

  /**
   * Evaluates if a transition is allowed.
   */
  public canTransition(
    currentState: CaseStatus,
    targetState: CaseStatus,
  ): boolean {
    // Idempotency rule: if the state is already the target state, it's a valid "no-op"
    if (currentState === targetState) {
      return true;
    }

    return this.transitionGraph[currentState]?.has(targetState) ?? false;
  }

  /**
   * Executes the transition logic.
   * @returns The resulting state if successful.
   * @throws InvalidStateTransitionException if illegal.
   */
  public transition(
    currentState: CaseStatus,
    targetState: CaseStatus,
  ): CaseStatus {
    if (!this.canTransition(currentState, targetState)) {
      throw new InvalidStateTransitionException(currentState, targetState);
    }

    return targetState;
  }
}
