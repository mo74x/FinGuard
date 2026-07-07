import { CaseStatus } from '../../../generated/prisma/enums';
import { DomainException } from '../../common/exceptions/domain.exception';

export class InvalidStateTransitionException extends DomainException {
  constructor(currentState: CaseStatus, targetState: CaseStatus) {
    super(
      `Cannot transition verification case from ${currentState} to ${targetState}.`,
      'INVALID_STATE_TRANSITION',
    );
  }
}
