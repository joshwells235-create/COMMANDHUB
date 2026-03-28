-- Seed organizations
INSERT INTO organizations (name, status, strategic_value) VALUES
  ('MMG Insurance', 'active', 'strategic'),
  ('ATS', 'active', 'strategic'),
  ('Lantheus', 'active', 'strategic'),
  ('North Star HVAC', 'active', 'emerging'),
  ('Burton', 'active', 'standard'),
  ('The Paper Store', 'active', 'standard'),
  ('Gladstone PE / GAIN', 'active', 'standard'),
  ('LEAP Business Advisors', 'active', 'emerging'),
  ('Supporting Strategies', 'active', 'standard');

-- Seed key contacts
INSERT INTO contacts (org_id, name, role, relationship_type) VALUES
  ((SELECT id FROM organizations WHERE name = 'MMG Insurance'), 'Matt McHatten', 'CEO', 'sponsor'),
  ((SELECT id FROM organizations WHERE name = 'MMG Insurance'), 'Kaci', NULL, 'coachee'),
  ((SELECT id FROM organizations WHERE name = 'MMG Insurance'), 'Stacey', NULL, 'coachee'),
  ((SELECT id FROM organizations WHERE name = 'MMG Insurance'), 'Cam', NULL, 'coachee'),
  ((SELECT id FROM organizations WHERE name = 'MMG Insurance'), 'Braden', NULL, 'coachee'),
  ((SELECT id FROM organizations WHERE name = 'MMG Insurance'), 'Nicole', NULL, 'coachee'),
  ((SELECT id FROM organizations WHERE name = 'MMG Insurance'), 'Diane', NULL, 'coachee'),
  ((SELECT id FROM organizations WHERE name = 'MMG Insurance'), 'Corey', NULL, 'coachee'),
  ((SELECT id FROM organizations WHERE name = 'ATS'), 'Caryn', NULL, 'coachee'),
  ((SELECT id FROM organizations WHERE name = 'ATS'), 'Jenny Goldstein', 'CDO', 'coachee'),
  ((SELECT id FROM organizations WHERE name = 'Lantheus'), 'Cheryl', 'Sr. Director L&OD', 'sponsor'),
  ((SELECT id FROM organizations WHERE name = 'Lantheus'), 'Jen Carlson', NULL, 'stakeholder'),
  ((SELECT id FROM organizations WHERE name = 'Lantheus'), 'Jim Donnelly', NULL, 'stakeholder'),
  ((SELECT id FROM organizations WHERE name = 'North Star HVAC'), 'Travis', 'CEO', 'sponsor'),
  ((SELECT id FROM organizations WHERE name = 'LEAP Business Advisors'), 'Kurt', NULL, 'sponsor');
