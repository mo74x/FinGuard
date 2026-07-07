/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { VerificationStateMachineService } from './verification-state-machine.service';
import { CaseStatus } from '../../generated/prisma/enums';
import { InvalidStateTransitionException } from './exceptions/invalid-state-transition.exception';

describe('VerificationStateMachineService', () => {
  let service: VerificationStateMachineService;

  beforeEach(() => {
    service = new VerificationStateMachineService();
  });

  describe('Transition Matrix', () => {
    // 1. Define all known states dynamically from the Prisma enum
    const ALL_STATES = Object.values(CaseStatus);

    // 2. Define the explicit whitelist of valid state changes (excluding self-transitions)
    const VALID_TRANSITIONS: Array<[CaseStatus, CaseStatus]> = [
      [CaseStatus.DRAFT, CaseStatus.SUBMITTED],
      [CaseStatus.SUBMITTED, CaseStatus.UNDER_REVIEW],
      [CaseStatus.UNDER_REVIEW, CaseStatus.VERIFIED],
      [CaseStatus.UNDER_REVIEW, CaseStatus.REJECTED],
      [CaseStatus.UNDER_REVIEW, CaseStatus.ADDITIONAL_INFO_REQUIRED],
      [CaseStatus.ADDITIONAL_INFO_REQUIRED, CaseStatus.SUBMITTED],
    ];

    // 3. Generate the exhaustive 36-scenario matrix (6 states x 6 states)
    const matrix = ALL_STATES.flatMap((currentState) =>
      ALL_STATES.map((targetState) => {
        const isSelfTransition = currentState === targetState;
        const isValid =
          isSelfTransition ||
          VALID_TRANSITIONS.some(
            ([from, to]) => from === currentState && to === targetState,
          );
        return { currentState, targetState, isValid, isSelfTransition };
      }),
    );

    it('should generate exactly 36 scenarios for a 6-state machine', () => {
      expect(matrix).toHaveLength(36);
    });

    // 4. Run the data-driven tests
    describe.each(matrix)(
      '$currentState -> $targetState',
      ({ currentState, targetState, isValid, isSelfTransition }) => {
        if (isValid) {
          it(`should PERMIT transition`, () => {
            expect(service.canTransition(currentState, targetState)).toBe(true);
            expect(service.transition(currentState, targetState)).toBe(
              targetState,
            );
          });

          if (isSelfTransition) {
            it('should handle idempotency (self-transition) without erroring', () => {
              expect(service.transition(currentState, currentState)).toBe(
                currentState,
              );
            });
          }
        } else {
          it(`should REJECT transition with InvalidStateTransitionException`, () => {
            expect(service.canTransition(currentState, targetState)).toBe(
              false,
            );
            expect(() => service.transition(currentState, targetState)).toThrow(
              InvalidStateTransitionException,
            );
            expect(() => service.transition(currentState, targetState)).toThrow(
              expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
            );
          });
        }
      },
    );
  });
});
