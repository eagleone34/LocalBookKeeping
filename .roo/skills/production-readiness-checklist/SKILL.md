Production Readiness Checklist
Before telling the user a feature is complete, the Orchestrator must verify:


Terminal throws zero build or linting errors (npm run build or equivalent passes).


All edge cases and error states (network failure, empty data) have been handled in the UI.


Leftover console.log debugging statements have been removed.


Database migrations (if applicable) are properly generated and documented.


The codebase is clean, well-commented for complex logic, and ready for deployment.